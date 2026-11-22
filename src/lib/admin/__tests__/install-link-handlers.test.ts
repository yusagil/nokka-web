// @vitest-environment node
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InstallLinkStore, IssueOutcome, RevokeOutcome } from "@/lib/update-packages/install-links";
import { createInstallLinkHandlers } from "../handlers";
import type { AdminSessionResult } from "../session";

vi.mock("server-only", () => ({}));

const ORIGIN = "http://localhost:3000";
const ADMIN: AdminSessionResult = { ok: true, admin: { githubUserId: "212495406" } };
// Synthetic link secret for tests only (43 base64url characters).
const TOKEN = "t".repeat(42) + "A";
const ISSUED: IssueOutcome = {
  kind: "issued",
  link: { expiresAt: "2026-11-26T00:00:00.000Z", build: 24, version: "2.7.0" },
};

function fakeLinks(issue: IssueOutcome = ISSUED, revoke: RevokeOutcome = { kind: "revoked", revoked: 1 }) {
  return {
    issue: vi.fn<InstallLinkStore["issue"]>(async () => issue),
    revoke: vi.fn<InstallLinkStore["revoke"]>(async () => revoke),
    resolve: vi.fn<InstallLinkStore["resolve"]>(),
    recordDownload: vi.fn<InstallLinkStore["recordDownload"]>(),
  };
}

function handlers(links: InstallLinkStore | null, session: AdminSessionResult = ADMIN) {
  return createInstallLinkHandlers({
    getAdminSession: async () => session,
    getAllowedOrigin: () => ORIGIN,
    getLinkStore: () => links,
    newToken: () => TOKEN,
  });
}

function request(
  method: "POST" | "DELETE",
  { headers = {}, body = method === "POST" ? "{}" : undefined }: { headers?: Record<string, string | null>; body?: string } = {},
) {
  const merged: Record<string, string | null> = {
    origin: ORIGIN,
    "content-type": "application/json",
    "x-admin-request": "1",
    ...headers,
  };
  const init: Record<string, string> = {};
  for (const [key, value] of Object.entries(merged)) if (value !== null) init[key] = value;
  return new Request(`${ORIGIN}/api/admin/applications/7/install-link`, { method, headers: init, body });
}

const params = (id = "7") => ({ params: Promise.resolve({ id }) });

async function expectJson(response: Response, status: number, body: unknown) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual(body);
}

let logs: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(() => {
  logs = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => {}),
  );
});
afterEach(() => {
  // The link secret is in the issuing response only, never in logs.
  expect(JSON.stringify(logs.flatMap((spy) => spy.mock.calls))).not.toContain(TOKEN);
  vi.restoreAllMocks();
});

describe("admin install link API", () => {
  it("issues a link on this deployment's origin with the secret in the fragment, storing only its SHA-256", async () => {
    const links = fakeLinks();
    const response = await handlers(links).POST(request("POST"), params());
    await expectJson(response, 201, {
      ok: true,
      link: {
        url: `${ORIGIN}/install#${TOKEN}`,
        expiresAt: "2026-11-26T00:00:00.000Z",
        build: 24,
        version: "2.7.0",
      },
    });
    expect(links.issue).toHaveBeenCalledTimes(1);
    const [id, { tokenHash, ttlSeconds }] = links.issue.mock.calls[0];
    expect(id).toBe("7");
    expect(tokenHash.toString("hex")).toBe(createHash("sha256").update(TOKEN).digest("hex"));
    expect(ttlSeconds).toBe(72 * 60 * 60);
  });

  it.each([
    ["not_found", 404, "NOT_FOUND"],
    ["not_approved", 409, "UPDATES_NOT_APPROVED"],
    ["no_installer", 409, "NO_INSTALLER"],
  ] as const)("maps %s to %i %s", async (kind, status, code) => {
    const response = await handlers(fakeLinks({ kind })).POST(request("POST"), params());
    await expectJson(response, status, { ok: false, code });
  });

  it("revokes the open link and reports whether one was still unexpired", async () => {
    const links = fakeLinks(ISSUED, { kind: "revoked", revoked: 0 });
    await expectJson(await handlers(links).DELETE(request("DELETE"), params()), 200, { ok: true, revoked: 0 });
    expect(links.revoke).toHaveBeenCalledWith("7");
    await expectJson(await handlers(fakeLinks(ISSUED, { kind: "not_found" })).DELETE(request("DELETE"), params()), 404, {
      ok: false,
      code: "NOT_FOUND",
    });
  });

  it.each([
    ["unauthenticated", { ok: false, status: 401, code: "UNAUTHENTICATED" }, 401],
    ["another account", { ok: false, status: 403, code: "FORBIDDEN" }, 403],
  ] as const)("rejects %s before touching the store", async (_, session, status) => {
    const links = fakeLinks();
    const api = handlers(links, session);
    await expectJson(await api.POST(request("POST"), params()), status, { ok: false, code: session.code });
    await expectJson(await api.DELETE(request("DELETE"), params()), status, { ok: false, code: session.code });
    expect(links.issue).not.toHaveBeenCalled();
    expect(links.revoke).not.toHaveBeenCalled();
  });

  it.each([
    ["another Origin", { origin: "https://evil.example" }, 403, "FORBIDDEN"],
    ["a missing X-Admin-Request header", { "x-admin-request": null }, 403, "FORBIDDEN"],
    ["a non-JSON body", { "content-type": "text/plain" }, 415, "UNSUPPORTED_MEDIA_TYPE"],
  ])("rejects %s", async (_, headers, status, code) => {
    const links = fakeLinks();
    await expectJson(await handlers(links).POST(request("POST", { headers }), params()), status, { ok: false, code });
    await expectJson(await handlers(links).DELETE(request("DELETE", { headers }), params()), status, { ok: false, code });
    expect(links.issue).not.toHaveBeenCalled();
    expect(links.revoke).not.toHaveBeenCalled();
  });

  it("accepts only an empty JSON object and a request id", async () => {
    const links = fakeLinks();
    for (const body of ['{"build":25}', "[]", "", "not json"]) {
      await expectJson(await handlers(links).POST(request("POST", { body }), params()), 400, {
        ok: false,
        code: "INVALID_REQUEST",
      });
    }
    for (const id of ["0", "-1", "abc", "99999999999999999999"]) {
      await expectJson(await handlers(links).POST(request("POST"), params(id)), 404, { ok: false, code: "NOT_FOUND" });
      await expectJson(await handlers(links).DELETE(request("DELETE"), params(id)), 404, { ok: false, code: "NOT_FOUND" });
    }
    expect(links.issue).not.toHaveBeenCalled();
    expect(links.revoke).not.toHaveBeenCalled();
  });

  it("answers 503 without a database or when the store fails, logging no secret", async () => {
    await expectJson(await handlers(null).POST(request("POST"), params()), 503, { ok: false, code: "UNAVAILABLE" });
    await expectJson(await handlers(null).DELETE(request("DELETE"), params()), 503, { ok: false, code: "UNAVAILABLE" });
    const failing = fakeLinks();
    failing.issue.mockRejectedValueOnce(Object.assign(new Error(`token ${TOKEN}`), { code: "ECONNRESET" }));
    await expectJson(await handlers(failing).POST(request("POST"), params()), 503, { ok: false, code: "UNAVAILABLE" });
  });
});
