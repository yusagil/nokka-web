// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { ADMIN_INBOX_URL, composeDigestMail, runApplicationDigest } from "../digest";
import type { DigestBatch, DigestClaim, DigestStore } from "../digest-store";
import type { DigestMail, DigestMailer, SendResult } from "../mailer";

vi.mock("server-only", () => ({}));

const BATCH: DigestBatch = { id: "batch-1", count: 3, attempt: 1, mayRepeat: false };

function fakeStore(claim: DigestClaim = { kind: "send", batch: BATCH }) {
  return {
    claim: vi.fn(async () => claim),
    markSendAttempt: vi.fn<DigestStore["markSendAttempt"]>(async () => true),
    markSent: vi.fn<DigestStore["markSent"]>(async () => true),
    markFailed: vi.fn<DigestStore["markFailed"]>(async () => true),
    markUnknown: vi.fn<DigestStore["markUnknown"]>(async () => true),
  } satisfies DigestStore;
}

function fakeMailer(access: { ok: false; code: string } | SendResult) {
  const send = vi.fn<(mail: DigestMail) => Promise<SendResult>>(async () => access as SendResult);
  const authorize = vi.fn<DigestMailer["authorize"]>(async () =>
    "outcome" in access ? { ok: true, send } : access,
  );
  return { authorize, send } satisfies DigestMailer & { send: unknown };
}

describe("composeDigestMail", () => {
  it("states only the count and the login-protected inbox link", () => {
    const mail = composeDigestMail(3);
    expect(ADMIN_INBOX_URL).toBe("https://nokka-web.vercel.app/admin/applications");
    expect(mail.subject).toBe("Nokka 새 사용 신청 3건");
    expect(mail.text).toContain("새 사용 신청 3건");
    expect(mail.text).toContain(`신청함 보기(로그인 필요): ${ADMIN_INBOX_URL}`);
    expect(mail.text).not.toMatch(/@/);
  });
});

describe("runApplicationDigest", () => {
  it("does not touch the mail account when there is nothing to send or another call is busy", async () => {
    for (const claim of [
      { kind: "skipped", reason: "empty" },
      { kind: "skipped", reason: "already_sent_today" },
      { kind: "skipped", reason: "attempted_today" },
      { kind: "busy" },
    ] as const) {
      const mailer = fakeMailer({ outcome: "accepted", messageId: "m" });
      const result = await runApplicationDigest({ store: fakeStore(claim), mailer });
      expect(result).toEqual({ ok: true, status: claim.kind, count: 0 });
      expect(mailer.authorize).not.toHaveBeenCalled();
    }
  });

  it("records the send attempt before the single send, and sent only after a message id", async () => {
    const store = fakeStore();
    const order: string[] = [];
    store.markSendAttempt.mockImplementation(async () => (order.push("attempt"), true));
    const mailer = fakeMailer({ outcome: "accepted", messageId: "msg-1" });
    mailer.send.mockImplementation(async () => (order.push("send"), { outcome: "accepted", messageId: "msg-1" }));

    expect(await runApplicationDigest({ store, mailer })).toEqual({
      ok: true,
      status: "sent",
      count: 3,
      mayRepeat: false,
    });
    expect(order).toEqual(["attempt", "send"]);
    expect(mailer.send).toHaveBeenCalledExactlyOnceWith(composeDigestMail(3));
    expect(store.markSent).toHaveBeenCalledWith(BATCH, "msg-1");
    expect(store.markFailed).not.toHaveBeenCalled();
    expect(store.markUnknown).not.toHaveBeenCalled();
  });

  it("records a token failure as failed without a send attempt", async () => {
    const store = fakeStore();
    const mailer = fakeMailer({ ok: false, code: "gmail_token_400_invalid_grant" });
    expect(await runApplicationDigest({ store, mailer })).toEqual({
      ok: false,
      reason: "failed",
      code: "gmail_token_400_invalid_grant",
    });
    expect(store.markSendAttempt).not.toHaveBeenCalled();
    expect(mailer.send).not.toHaveBeenCalled();
    expect(store.markFailed).toHaveBeenCalledWith(BATCH, "gmail_token_400_invalid_grant");
    expect(store.markSent).not.toHaveBeenCalled();
  });

  it("marks a refused send failed and an uncertain one unknown, each after exactly one send", async () => {
    for (const [result, reason, mark] of [
      [{ outcome: "rejected", code: "gmail_send_403_dailyLimitExceeded" }, "failed", "markFailed"],
      [{ outcome: "uncertain", code: "gmail_send_timeout" }, "unknown", "markUnknown"],
    ] as const) {
      const store = fakeStore();
      const mailer = fakeMailer(result);
      expect(await runApplicationDigest({ store, mailer })).toEqual({ ok: false, reason, code: result.code });
      expect(mailer.send).toHaveBeenCalledOnce();
      expect(store[mark]).toHaveBeenCalledWith(BATCH, result.code);
      expect(store.markSent).not.toHaveBeenCalled();
    }
  });

  it("keeps a batch that may already have arrived unknown when this try fails", async () => {
    const batch = { ...BATCH, attempt: 2, mayRepeat: true };
    for (const access of [
      { ok: false, code: "gmail_token_400_invalid_grant" },
      { outcome: "rejected", code: "gmail_send_429_rateLimitExceeded" },
    ] as const) {
      const store = fakeStore({ kind: "send", batch });
      const result = await runApplicationDigest({ store, mailer: fakeMailer(access) });
      expect(result).toEqual({ ok: false, reason: "unknown", code: access.code });
      expect(store.markUnknown).toHaveBeenCalledWith(batch, access.code);
      expect(store.markFailed).not.toHaveBeenCalled();
    }
  });

  it("reports a send that may repeat an earlier uncertain one", async () => {
    const batch = { ...BATCH, attempt: 2, mayRepeat: true };
    const store = fakeStore({ kind: "send", batch });
    expect(await runApplicationDigest({ store, mailer: fakeMailer({ outcome: "accepted", messageId: "m2" }) })).toEqual({
      ok: true,
      status: "sent",
      count: 3,
      mayRepeat: true,
    });
  });

  it("sends nothing when the send attempt cannot be recorded for this claim", async () => {
    const store = fakeStore();
    store.markSendAttempt.mockResolvedValue(false);
    const mailer = fakeMailer({ outcome: "accepted", messageId: "m" });
    expect(await runApplicationDigest({ store, mailer })).toEqual({ ok: true, status: "busy", count: 0 });
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it("reports a lost lease instead of sent when the record was fenced out", async () => {
    const store = fakeStore();
    store.markSent.mockResolvedValue(false);
    const mailer = fakeMailer({ outcome: "accepted", messageId: "msg-1" });
    expect(await runApplicationDigest({ store, mailer })).toEqual({ ok: false, reason: "unknown", code: "lease_lost" });
  });

  it("propagates a record failure after acceptance (the batch stays leased, not sent)", async () => {
    const store = fakeStore();
    store.markSent.mockRejectedValue(Object.assign(new Error("connection lost"), { code: "ECONNRESET" }));
    const mailer = fakeMailer({ outcome: "accepted", messageId: "msg-1" });
    await expect(runApplicationDigest({ store, mailer })).rejects.toThrow("connection lost");
  });
});
