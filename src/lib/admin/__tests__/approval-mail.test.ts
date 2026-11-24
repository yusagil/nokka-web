// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DigestMail, MailSender, SendResult } from "@/lib/notifications/mailer";
import { composeApprovalMail } from "@/lib/notifications/approval-mail";
import type { AdminApplicationsStore } from "../applications-store";
import { createApprovalMailRecoveryHandler } from "../approval-mail-cron";
import { runApprovalMail, sendApprovalMail, type ApprovalMailServices } from "../approval-mail";
import type { ApprovalMailStore, MailClaim, PreparedMail } from "../approval-mail-store";
import type { AdminApplication } from "../contracts";
import { createApprovalMailHandler, createUpdateHandler, type AdminHandlerOptions } from "../handlers";
import type { AdminSessionResult } from "../session";

vi.mock("server-only", () => ({}));

const ORIGIN = "http://localhost:3000";
const ADMIN: AdminSessionResult = { ok: true, admin: { githubUserId: "212495406" } };
// Synthetic link secret for tests only (43 base64url characters).
const TOKEN = "m".repeat(42) + "Q";
const EMAIL = "nokka-approval-mail-qa@example.com";
const NAME = "QA 승인 메일";
const CLAIM: MailClaim = { id: "11", attempt: 1 };
const READY: PreparedMail = {
  kind: "ready",
  to: EMAIL,
  name: NAME,
  link: { expiresAt: "2026-11-28T00:00:00.000Z", build: 24, version: "2.7.0" },
};

const ITEM: AdminApplication = {
  id: "7",
  name: NAME,
  email: EMAIL,
  createdAt: "2026-11-19T00:00:00.000Z",
  status: "new",
  operatorNote: "",
  lastContactedAt: null,
  updatedAt: "2026-11-19T00:00:00.000Z",
  updatesApproved: true,
  macRegistered: false,
  latestCodeMail: null,
  approvalMail: null,
};

function fakeMailStore(prepared: PreparedMail = READY, overrides: Partial<ApprovalMailStore> = {}) {
  const store = {
    claim: vi.fn<ApprovalMailStore["claim"]>(async () => CLAIM),
    claimLeftBehind: vi.fn<ApprovalMailStore["claimLeftBehind"]>(async () => []),
    prepare: vi.fn<ApprovalMailStore["prepare"]>(async () => prepared),
    markSending: vi.fn<ApprovalMailStore["markSending"]>(async () => true),
    finish: vi.fn<ApprovalMailStore["finish"]>(async () => {}),
    fail: vi.fn<ApprovalMailStore["fail"]>(async () => {}),
    request: vi.fn<ApprovalMailStore["request"]>(async () => ({ kind: "claimed", claim: CLAIM })),
  };
  // Overrides are mocks too; the type stays the mocks' own.
  return Object.assign(store, overrides) as typeof store;
}

/** Records every mail it is asked to send; `results` answers the sends in turn (default: accepted). */
function fakeSender({ authorized = true, results = [] as SendResult[] } = {}) {
  const sent: { to: string; mail: DigestMail }[] = [];
  const send = vi.fn(async (to: string, mail: DigestMail): Promise<SendResult> => {
    sent.push({ to, mail });
    return results[sent.length - 1] ?? { outcome: "accepted", messageId: "qa-message-1" };
  });
  const sender: MailSender = {
    authorize: vi.fn(async () => (authorized ? { ok: true as const, send } : { ok: false as const, code: "gmail_token_400_invalid_grant" })),
  };
  return { sender, sent, send };
}

function services(store: ApprovalMailStore, sender: MailSender | null = fakeSender().sender): ApprovalMailServices {
  return { store, sender, origin: ORIGIN, newToken: () => TOKEN };
}

let logs: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(() => {
  logs = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => {}),
  );
});
afterEach(() => {
  // The link's secret, the address and the name go into the mail only.
  const logged = JSON.stringify(logs.flatMap((spy) => spy.mock.calls));
  for (const value of [TOKEN, EMAIL, NAME]) expect(logged).not.toContain(value);
  vi.restoreAllMocks();
});

describe("approval mail attempt", () => {
  it("issues the link, records the start, then sends one mail with the link to the stored address", async () => {
    const store = fakeMailStore();
    const { sender, sent, send } = fakeSender();
    await runApprovalMail(CLAIM, services(store, sender));

    expect(store.prepare).toHaveBeenCalledExactlyOnceWith(CLAIM, { tokenHash: expect.any(Buffer), ttlSeconds: 72 * 3600 });
    // Only the token's SHA-256 reaches the store.
    const { tokenHash } = store.prepare.mock.calls[0][1];
    expect(tokenHash.toString("hex")).toBe((await import("node:crypto")).createHash("sha256").update(TOKEN).digest("hex"));
    // The save's own attempt has no deadline.
    expect(store.markSending).toHaveBeenCalledExactlyOnceWith(CLAIM, { inTime: undefined });
    // The start is committed before the one request to the mail service.
    expect(store.markSending.mock.invocationCallOrder[0]).toBeLessThan(send.mock.invocationCallOrder[0]);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(EMAIL);
    expect(sent[0].mail.text).toContain(`${ORIGIN}/install#${TOKEN}`);
    expect(store.finish).toHaveBeenCalledExactlyOnceWith(CLAIM, { outcome: "accepted", messageId: "qa-message-1" });
    expect(store.fail).not.toHaveBeenCalled();
  });

  it("asks for mail access before any link exists, and sends nothing when it is refused", async () => {
    const store = fakeMailStore();
    const { sender, send } = fakeSender({ authorized: false });
    await runApprovalMail(CLAIM, services(store, sender));
    expect(store.prepare).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(store.fail).toHaveBeenCalledExactlyOnceWith(CLAIM, "gmail_token_400_invalid_grant");
  });

  it("records mail_not_configured without a sender or an origin", async () => {
    const store = fakeMailStore();
    await runApprovalMail(CLAIM, services(store, null));
    await runApprovalMail(CLAIM, { ...services(store), origin: null });
    expect(store.fail).toHaveBeenCalledTimes(2);
    expect(store.fail).toHaveBeenNthCalledWith(1, CLAIM, "mail_not_configured");
    expect(store.prepare).not.toHaveBeenCalled();
  });

  it.each([
    ["stopped (withdrawn, replaced or claimed again)", { kind: "stopped" } as const],
    ["failed without an installer", { kind: "failed", code: "no_installer" } as const],
  ])("sends nothing when the link step %s", async (_, prepared) => {
    const store = fakeMailStore(prepared);
    const { sender, send } = fakeSender();
    await runApprovalMail(CLAIM, services(store, sender));
    expect(store.markSending).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(store.finish).not.toHaveBeenCalled();
  });

  it("sends nothing when the start can not be recorded for this attempt", async () => {
    const store = fakeMailStore(READY, { markSending: vi.fn(async () => false) });
    const { sender, send } = fakeSender();
    await runApprovalMail(CLAIM, services(store, sender));
    expect(send).not.toHaveBeenCalled();
    expect(store.finish).not.toHaveBeenCalled();
  });

  it.each([
    { outcome: "rejected", code: "gmail_send_400_invalidArgument" },
    { outcome: "uncertain", code: "gmail_send_timeout" },
  ] as const)("records a $outcome answer once and never asks again", async (result) => {
    const store = fakeMailStore();
    const { sender, send } = fakeSender({ results: [result] });
    await runApprovalMail(CLAIM, services(store, sender));
    expect(send).toHaveBeenCalledTimes(1);
    expect(store.finish).toHaveBeenCalledExactlyOnceWith(CLAIM, result);
  });

  it("asks once even when the answer can not be recorded", async () => {
    const store = fakeMailStore(READY, {
      finish: vi.fn(async () => {
        throw Object.assign(new Error(`lost ${EMAIL}`), { code: "ECONNRESET" });
      }),
    });
    const { sender, send } = fakeSender();
    await runApprovalMail(CLAIM, services(store, sender));
    expect(send).toHaveBeenCalledTimes(1);
    expect(store.fail).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith("[approval-mail]", "mail result was not recorded", {
      name: "Error",
      code: "ECONNRESET",
    });
  });

  it("records internal_error when a database step fails before the mail service is asked", async () => {
    const store = fakeMailStore(READY, {
      prepare: vi.fn(async () => {
        throw Object.assign(new Error("boom"), { code: "57P01" });
      }),
    });
    const { sender, send } = fakeSender();
    await runApprovalMail(CLAIM, services(store, sender));
    expect(send).not.toHaveBeenCalled();
    expect(store.fail).toHaveBeenCalledExactlyOnceWith(CLAIM, "internal_error");
  });

  it("does nothing for a mail someone else claimed", async () => {
    const store = fakeMailStore(READY, { claim: vi.fn(async () => null) });
    const { sender, send } = fakeSender();
    await sendApprovalMail("11", services(store, sender));
    expect(sender.authorize).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});

describe("approval mail content", () => {
  it("carries the link, its expiry in Seoul time, the one-press button and the code steps, in Korean and English", () => {
    const mail = composeApprovalMail({
      name: NAME,
      url: `${ORIGIN}/install#${TOKEN}`,
      expiresAt: "2026-11-28T00:00:00.000Z",
      version: "2.7.0",
    });
    expect(mail.subject).toBe("Nokka 사용 승인 안내 (Your Nokka access is approved)");
    expect(mail.text.split(`${ORIGIN}/install#${TOKEN}`)).toHaveLength(2);
    expect(mail.text).toContain(`${NAME}님`);
    expect(mail.text).toContain("2026. 11. 28. 09:00(한국 시간)");
    expect(mail.text).toContain("11/28/2026, 09:00 KST");
    expect(mail.text).toContain("‘설치 파일 받기’");
    expect(mail.text).toContain("한 번만");
    expect(mail.text).toContain("8자리 코드");
    expect(mail.text).toContain("‘업데이트 확인…’");
    expect(mail.text).toContain("Nokka 2.7.0");
    // The app asks for the code itself: no code is in this mail.
    expect(mail.text).not.toMatch(/\b\d{8}\b/);
  });
});

function adminRequest(body: unknown, headers: Record<string, string | null> = {}) {
  const merged: Record<string, string | null> = {
    origin: ORIGIN,
    "content-type": "application/json",
    "x-admin-request": "1",
    ...headers,
  };
  const init: Record<string, string> = {};
  for (const [key, value] of Object.entries(merged)) if (value !== null) init[key] = value;
  return new Request(`${ORIGIN}/api/admin/applications/7/approval-mail`, {
    method: "POST",
    headers: init,
    body: JSON.stringify(body),
  });
}

function fakeApplications(item: AdminApplication = ITEM, approvalMailId: string | null = null) {
  return {
    search: vi.fn<AdminApplicationsStore["search"]>(),
    update: vi.fn<AdminApplicationsStore["update"]>(async () => ({ kind: "updated", item, approvalMailId })),
    get: vi.fn<AdminApplicationsStore["get"]>(async () => ({
      ...item,
      approvalMail: {
        id: "11",
        trigger: "approval",
        status: "accepted",
        errorCode: null,
        createdAt: "2026-11-25T00:00:00.000Z",
        sendStartedAt: "2026-11-25T00:00:01.000Z",
        finishedAt: "2026-11-25T00:00:02.000Z",
        linkExpiresAt: "2026-11-28T00:00:00.000Z",
        linkState: "open",
      },
    })),
  };
}

function adminOptions(
  applications: AdminApplicationsStore | null,
  mail: ApprovalMailServices | null,
  session: AdminSessionResult = ADMIN,
): AdminHandlerOptions {
  return {
    getAdminSession: async () => session,
    getStore: () => applications,
    getAllowedOrigin: () => ORIGIN,
    getApprovalMail: () => mail,
  };
}

const params = (id = "7") => ({ params: Promise.resolve({ id }) });

describe("PATCH /api/admin/applications/:id with an approval", () => {
  it("sends the stored approval mail after the save and answers with the request as stored after it", async () => {
    const applications = fakeApplications(ITEM, "11");
    const store = fakeMailStore();
    const { sender, sent } = fakeSender();
    const response = await createUpdateHandler(adminOptions(applications, services(store, sender)))(
      new Request(`${ORIGIN}/api/admin/applications/7`, {
        method: "PATCH",
        headers: { origin: ORIGIN, "content-type": "application/json", "x-admin-request": "1" },
        body: JSON.stringify({ updatesApproved: true, expectedUpdatedAt: ITEM.updatedAt }),
      }),
      params(),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.item.approvalMail.status).toBe("accepted");
    // The link is in the mail, never in the admin answer.
    expect(JSON.stringify(body)).not.toContain(TOKEN);
    expect(store.claim).toHaveBeenCalledExactlyOnceWith("11");
    expect(sent).toHaveLength(1);
  });

  it("sends nothing for a save that stored no approval mail", async () => {
    const applications = fakeApplications(ITEM, null);
    const store = fakeMailStore();
    const { sender, send } = fakeSender();
    const response = await createUpdateHandler(adminOptions(applications, services(store, sender)))(
      new Request(`${ORIGIN}/api/admin/applications/7`, {
        method: "PATCH",
        headers: { origin: ORIGIN, "content-type": "application/json", "x-admin-request": "1" },
        body: JSON.stringify({ updatesApproved: true, expectedUpdatedAt: ITEM.updatedAt }),
      }),
      params(),
    );
    expect(response.status).toBe(200);
    expect(store.claim).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(applications.get).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/applications/:id/approval-mail", () => {
  const post = (
    applications: AdminApplicationsStore | null,
    mail: ApprovalMailServices | null,
    body: unknown,
    { headers, session, id }: { headers?: Record<string, string | null>; session?: AdminSessionResult; id?: string } = {},
  ) => createApprovalMailHandler(adminOptions(applications, mail, session))(adminRequest(body, headers), params(id));

  it.each([
    ["unauthenticated", { headers: {}, session: { ok: false, status: 401, code: "UNAUTHENTICATED" } as const }, 401, "UNAUTHENTICATED"],
    ["another account", { headers: {}, session: { ok: false, status: 403, code: "FORBIDDEN" } as const }, 403, "FORBIDDEN"],
    ["another Origin", { headers: { origin: "https://evil.example" } }, 403, "FORBIDDEN"],
    ["no X-Admin-Request", { headers: { "x-admin-request": null } }, 403, "FORBIDDEN"],
    ["a form post", { headers: { "content-type": "application/x-www-form-urlencoded" } }, 415, "UNSUPPORTED_MEDIA_TYPE"],
  ])("rejects %s before any mail or link changes", async (_, extra, status, code) => {
    const store = fakeMailStore();
    const { sender, send } = fakeSender();
    const response = await post(fakeApplications(), services(store, sender), { expectedMailId: null, intent: "send" }, extra);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ ok: false, code });
    expect(store.request).not.toHaveBeenCalled();
    expect(store.prepare).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    ["no expectedMailId", { intent: "send" }],
    ["no intent", { expectedMailId: null }],
    ["an unknown intent", { expectedMailId: null, intent: "force" }],
    ["an unknown key", { expectedMailId: null, intent: "send", force: true }],
    ["a numeric id", { expectedMailId: 11, intent: "resend" }],
    ["a malformed id", { expectedMailId: "01", intent: "resend" }],
  ])("rejects %s with INVALID_REQUEST", async (_, body) => {
    const store = fakeMailStore();
    const response = await post(fakeApplications(), services(store), body);
    expect(response.status).toBe(400);
    expect(store.request).not.toHaveBeenCalled();
  });

  it("sends with the expected mail and answers with the request as stored after the attempt", async () => {
    const store = fakeMailStore();
    const { sender, sent } = fakeSender();
    const response = await post(fakeApplications(), services(store, sender), { expectedMailId: "10", intent: "resend" });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.item.approvalMail.id).toBe("11");
    expect(JSON.stringify(body)).not.toContain(TOKEN);
    expect(store.request).toHaveBeenCalledExactlyOnceWith("7", "10", "resend");
    expect(sent).toHaveLength(1);
  });

  it.each([
    ["not_found", 404, "NOT_FOUND"],
    ["not_approved", 409, "UPDATES_NOT_APPROVED"],
    ["conflict", 409, "CONFLICT"],
    ["in_progress", 409, "MAIL_IN_PROGRESS"],
  ] as const)("maps %s to %i without sending", async (kind, status, code) => {
    const store = fakeMailStore(READY, { request: vi.fn(async () => ({ kind })) });
    const { sender, send } = fakeSender();
    const response = await post(fakeApplications(), services(store, sender), { expectedMailId: null, intent: "send" });
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ ok: false, code });
    expect(send).not.toHaveBeenCalled();
  });

  it("answers 503 without a database", async () => {
    const response = await post(null, null, { expectedMailId: null, intent: "send" });
    expect(response.status).toBe(503);
  });
});

describe("GET /api/cron/approval-mails", () => {
  const SECRET = "qa-cron-secret-0123456789";
  const call = (handler: ReturnType<typeof createApprovalMailRecoveryHandler>, authorization: string | null) =>
    handler(new Request(`${ORIGIN}/api/cron/approval-mails`, { headers: authorization ? { authorization } : {} }));

  it("needs the cron secret, and mail settings before it claims anything", async () => {
    const store = fakeMailStore();
    const unset = createApprovalMailRecoveryHandler({ getCronSecret: () => null, getServices: () => services(store) });
    expect((await call(unset, `Bearer ${SECRET}`)).status).toBe(503);
    const handler = createApprovalMailRecoveryHandler({ getCronSecret: () => SECRET, getServices: () => services(store) });
    expect((await call(handler, "Bearer wrong-secret-0123456789")).status).toBe(401);
    const noMail = createApprovalMailRecoveryHandler({ getCronSecret: () => SECRET, getServices: () => services(store, null) });
    expect((await call(noMail, `Bearer ${SECRET}`)).status).toBe(503);
    expect(store.claimLeftBehind).not.toHaveBeenCalled();
  });

  /** A store with `count` mails left behind, handed out one per claim. */
  const leftBehind = (count: number) => {
    const waiting = Array.from({ length: count }, (_, index) => ({ id: String(21 + index), attempt: 1 }));
    return fakeMailStore(READY, { claimLeftBehind: vi.fn(async (limit: number) => waiting.splice(0, limit)) });
  };

  it("sends each mail left behind once, claiming one at a time", async () => {
    const store = leftBehind(2);
    const { sender, sent } = fakeSender();
    const handler = createApprovalMailRecoveryHandler({ getCronSecret: () => SECRET, getServices: () => services(store, sender) });
    const response = await call(handler, `Bearer ${SECRET}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, attempted: 2 });
    // The third claim finds nothing and ends the run.
    expect(store.claimLeftBehind.mock.calls).toEqual([[1], [1], [1]]);
    expect(sent).toHaveLength(2);
    expect(store.finish.mock.calls.map(([claim]) => claim.id)).toEqual(["21", "22"]);
  });

  it("claims no mail it has no time left to send", async () => {
    // Every Gmail request takes 8 s on this clock, so each attempt takes 16 s.
    let clock = 0;
    const store = leftBehind(20);
    const { sender, sent, send } = fakeSender();
    send.mockImplementation(async (to, mail) => {
      clock += 16_000;
      sent.push({ to, mail });
      return { outcome: "accepted", messageId: "qa" };
    });
    const handler = createApprovalMailRecoveryHandler({
      getCronSecret: () => SECRET,
      getServices: () => services(store, sender),
      now: () => clock,
    });
    // 50 s, 25 s reserved per attempt: attempts start at 0, 16 s; the one at 32 s would not fit.
    expect(await (await call(handler, `Bearer ${SECRET}`)).json()).toEqual({ ok: true, attempted: 2 });
    expect(store.claimLeftBehind).toHaveBeenCalledTimes(2);
    expect(sent).toHaveLength(2);
    // The other 18 were never claimed.
    expect((await store.claimLeftBehind(20)).length).toBe(18);
  });

  it("asks, once an attempt holds its rows, whether the send still fits before the deadline", async () => {
    let clock = 0;
    const store = leftBehind(1);
    // The rows took 45 s to get: 45 + 10 s of send and record no longer fit in 50 s.
    store.markSending.mockImplementation(async (_claim, options) => {
      clock = 45_000;
      return options?.inTime?.() ?? true;
    });
    const { sender, send } = fakeSender();
    const handler = createApprovalMailRecoveryHandler({
      getCronSecret: () => SECRET,
      getServices: () => services(store, sender),
      now: () => clock,
    });
    expect(await (await call(handler, `Bearer ${SECRET}`)).json()).toEqual({ ok: true, attempted: 1 });
    expect(send).not.toHaveBeenCalled();
    expect(store.finish).not.toHaveBeenCalled();
  });

  it("stops at the limit even with time to spare", async () => {
    const store = leftBehind(30);
    const handler = createApprovalMailRecoveryHandler({ getCronSecret: () => SECRET, getServices: () => services(store) });
    expect(await (await call(handler, `Bearer ${SECRET}`)).json()).toEqual({ ok: true, attempted: 20 });
  });
});
