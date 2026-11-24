// @vitest-environment node
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import type { AdminApplicationsStore, SearchParams, UpdateParams } from "../applications-store";
import type { AdminApplication } from "../contracts";
import { createSearchHandler, createUpdateHandler, type AdminHandlerOptions } from "../handlers";
import type { AdminSessionResult } from "../session";

vi.mock("server-only", () => ({}));

const ORIGIN = "http://localhost:3000";
const SECRET_TERM = "qa-search-term@example.com";
const NOTE = "QA 메모 내용";
const ADMIN: AdminSessionResult = { ok: true, admin: { githubUserId: "212495406" } };

const ITEM: AdminApplication = {
  id: "7",
  name: "QA 신청 테스트",
  email: "nokka-apply-qa-admin@example.com",
  createdAt: "2026-11-19T00:00:00.000Z",
  status: "new",
  operatorNote: "",
  lastContactedAt: null,
  updatedAt: "2026-11-19T00:00:00.000Z",
  updatesApproved: false,
};

function fakeStore(overrides: Partial<AdminApplicationsStore> = {}) {
  return {
    search: vi.fn<(params: SearchParams) => ReturnType<AdminApplicationsStore["search"]>>(async () => ({
      items: [ITEM],
      nextCursor: null,
    })),
    update: vi.fn<(id: string, params: UpdateParams) => ReturnType<AdminApplicationsStore["update"]>>(async () => ({
      kind: "updated",
      item: ITEM,
    })),
    ...overrides,
  };
}

function options(store: AdminApplicationsStore | null, session = ADMIN): AdminHandlerOptions {
  return {
    getAdminSession: async () => session,
    getStore: () => store,
    getAllowedOrigin: () => ORIGIN,
  };
}

function request(
  method: "POST" | "PATCH",
  body: unknown,
  { headers = {}, raw }: { headers?: Record<string, string | null>; raw?: BodyInit } = {},
) {
  const merged: Record<string, string | null> = {
    origin: ORIGIN,
    "content-type": "application/json",
    "x-admin-request": "1",
    ...headers,
  };
  const init: Record<string, string> = {};
  for (const [key, value] of Object.entries(merged)) if (value !== null) init[key] = value;
  return new Request(`${ORIGIN}/api/admin/applications/x`, {
    method,
    headers: init,
    body: raw ?? JSON.stringify(body),
  });
}

const search = (store: AdminApplicationsStore | null, body: unknown, extra?: Parameters<typeof request>[2], session?: AdminSessionResult) =>
  createSearchHandler(options(store, session))(request("POST", body, extra));

const update = (store: AdminApplicationsStore | null, id: string, body: unknown, extra?: Parameters<typeof request>[2], session?: AdminSessionResult) =>
  createUpdateHandler(options(store, session))(request("PATCH", body, extra), { params: Promise.resolve({ id }) });

async function expectFailure(response: Response, status: number, body: unknown) {
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
  const logged = JSON.stringify(logs.flatMap((spy) => spy.mock.calls));
  for (const value of [SECRET_TERM, NOTE, ITEM.email, ITEM.name]) expect(logged).not.toContain(value);
  vi.restoreAllMocks();
});

describe("admin API guard (search and update)", () => {
  it.each([
    ["unauthenticated", { ok: false, status: 401, code: "UNAUTHENTICATED" }, 401],
    ["another account", { ok: false, status: 403, code: "FORBIDDEN" }, 403],
    ["unconfigured auth", { ok: false, status: 503, code: "UNAVAILABLE" }, 503],
  ] as const)("rejects %s before touching the store", async (_, session, status) => {
    const store = fakeStore();
    await expectFailure(await search(store, {}, undefined, session), status, { ok: false, code: session.code });
    await expectFailure(
      await update(store, "7", { status: "hold", expectedUpdatedAt: ITEM.updatedAt }, undefined, session),
      status,
      { ok: false, code: session.code },
    );
    expect(store.search).not.toHaveBeenCalled();
    expect(store.update).not.toHaveBeenCalled();
  });

  it.each([
    ["a missing Origin", { origin: null }],
    ["another Origin", { origin: "https://evil.example" }],
    ["the public site Origin", { origin: "https://nokka-web.vercel.app" }],
    ["a missing X-Admin-Request header", { "x-admin-request": null }],
    ["a wrong X-Admin-Request value", { "x-admin-request": "true" }],
  ])("rejects %s with 403 even for the admin", async (_, headers) => {
    const store = fakeStore();
    await expectFailure(await search(store, {}, { headers }), 403, { ok: false, code: "FORBIDDEN" });
    await expectFailure(
      await update(store, "7", { status: "hold", expectedUpdatedAt: ITEM.updatedAt }, { headers }),
      403,
      { ok: false, code: "FORBIDDEN" },
    );
    expect(store.search).not.toHaveBeenCalled();
    expect(store.update).not.toHaveBeenCalled();
  });

  it("rejects non-JSON with 415 and bodies over 8 KiB with 413", async () => {
    const store = fakeStore();
    await expectFailure(await search(store, {}, { headers: { "content-type": "text/plain" } }), 415, {
      ok: false,
      code: "UNSUPPORTED_MEDIA_TYPE",
    });
    await expectFailure(await search(store, { q: "x".repeat(9000) }), 413, { ok: false, code: "PAYLOAD_TOO_LARGE" });
  });

  it("answers 503 when the database is not configured", async () => {
    await expectFailure(await search(null, {}), 503, { ok: false, code: "UNAVAILABLE" });
    await expectFailure(await update(null, "7", { status: "hold", expectedUpdatedAt: ITEM.updatedAt }), 503, {
      ok: false,
      code: "UNAVAILABLE",
    });
  });
});

describe("POST /api/admin/applications/search", () => {
  it("applies defaults and trims the search term", async () => {
    const store = fakeStore();
    const response = await search(store, { q: `  ${SECRET_TERM}  ` });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: true, items: [ITEM], nextCursor: null });
    expect(store.search).toHaveBeenCalledExactlyOnceWith({ q: SECRET_TERM, status: "all", cursor: null, limit: 20 });
  });

  it("hands out an opaque cursor without names, emails or terms and accepts it back", async () => {
    const position = { createdAt: "2026-11-19T00:00:00.123456Z", id: "41" };
    const store = fakeStore({ search: vi.fn(async () => ({ items: [ITEM], nextCursor: position })) });
    const first = await (await search(store, { q: SECRET_TERM, status: "hold", limit: 1 })).json();

    expect(typeof first.nextCursor).toBe("string");
    for (const value of [SECRET_TERM, ITEM.email, ITEM.name, "hold"]) {
      expect(first.nextCursor).not.toContain(value);
    }

    await search(store, { q: SECRET_TERM, status: "hold", limit: 1, cursor: first.nextCursor });
    expect(store.search).toHaveBeenLastCalledWith({ q: SECRET_TERM, status: "hold", cursor: position, limit: 1 });
  });

  it.each([
    ["malformed JSON", undefined, "{"],
    ["an array", [], undefined],
    ["an unknown key", { q: "a", sort: "name" }, undefined],
    ["a non-string q", { q: 3 }, undefined],
    ["a non-number limit", { limit: "20" }, undefined],
    ["a non-string cursor", { cursor: 5 }, undefined],
  ])("rejects %s with INVALID_REQUEST", async (_, body, raw) => {
    const store = fakeStore();
    await expectFailure(await search(store, body, raw ? { raw } : undefined), 400, { ok: false, code: "INVALID_REQUEST" });
    expect(store.search).not.toHaveBeenCalled();
  });

  it.each([
    [{ q: "a".repeat(101) }, { q: "TOO_LONG" }],
    [{ q: "a\u0000b" }, { q: "INVALID" }],
    [{ status: "archived" }, { status: "INVALID" }],
    [{ limit: 0 }, { limit: "INVALID" }],
    [{ limit: 51 }, { limit: "INVALID" }],
    [{ limit: 2.5 }, { limit: "INVALID" }],
    [{ cursor: "not-a-cursor" }, { cursor: "INVALID" }],
    [{ cursor: Buffer.from(JSON.stringify(["2026-11-19", "1"])).toString("base64url") }, { cursor: "INVALID" }],
  ])("rejects %j with VALIDATION_ERROR %j", async (body, fieldErrors) => {
    const store = fakeStore();
    const response = await search(store, body);
    await expectFailure(response, 400, { ok: false, code: "VALIDATION_ERROR", fieldErrors });
    expect(store.search).not.toHaveBeenCalled();
  });

  it("accepts the maximum lengths and limits", async () => {
    const store = fakeStore();
    expect((await search(store, { q: "a".repeat(100), limit: 50, status: "contacted" })).status).toBe(200);
    expect((await search(store, { limit: 1, status: "new", cursor: null })).status).toBe(200);
  });

  it("answers 503 when the query fails, without logging the term", async () => {
    const store = fakeStore({
      search: vi.fn(async () => {
        throw Object.assign(new Error(`ILIKE ${SECRET_TERM}`), { code: "57014" });
      }),
    });
    await expectFailure(await search(store, { q: SECRET_TERM }), 503, { ok: false, code: "UNAVAILABLE" });
    expect(console.error).toHaveBeenCalledWith("[admin]", "search failed", { name: "Error", code: "57014" });
  });
});

describe("PATCH /api/admin/applications/:id", () => {
  it("passes a trimmed note and returns the updated item", async () => {
    const store = fakeStore();
    const response = await update(store, "7", {
      status: "contacted",
      operatorNote: `  ${NOTE}\n`,
      expectedUpdatedAt: ITEM.updatedAt,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: true, item: ITEM });
    expect(store.update).toHaveBeenCalledExactlyOnceWith("7", {
      status: "contacted",
      operatorNote: NOTE,
      expectedUpdatedAt: ITEM.updatedAt,
    });
  });

  it("allows clearing the note and a multi-line note of 500 characters", async () => {
    const store = fakeStore();
    expect((await update(store, "7", { operatorNote: "", expectedUpdatedAt: ITEM.updatedAt })).status).toBe(200);
    const note = `${"가".repeat(249)}\n${"나".repeat(250)}`;
    expect((await update(store, "7", { operatorNote: note, expectedUpdatedAt: ITEM.updatedAt })).status).toBe(200);
  });

  it.each([true, false])("passes updatesApproved %s alone, without status or note", async (updatesApproved) => {
    const store = fakeStore();
    const response = await update(store, "7", { updatesApproved, expectedUpdatedAt: ITEM.updatedAt });
    expect(response.status).toBe(200);
    expect(store.update).toHaveBeenCalledExactlyOnceWith("7", {
      status: undefined,
      operatorNote: undefined,
      updatesApproved,
      expectedUpdatedAt: ITEM.updatedAt,
    });
  });

  it.each(["0", "-1", "abc", "7.5", "9223372036854775808", "01"])("answers 404 for id %s", async (id) => {
    const store = fakeStore();
    await expectFailure(await update(store, id, { status: "hold", expectedUpdatedAt: ITEM.updatedAt }), 404, {
      ok: false,
      code: "NOT_FOUND",
    });
    expect(store.update).not.toHaveBeenCalled();
  });

  it.each([
    ["neither status nor note", { expectedUpdatedAt: ITEM.updatedAt }],
    ["a missing token", { status: "hold" }],
    ["a client-set contact time", { status: "contacted", lastContactedAt: ITEM.updatedAt, expectedUpdatedAt: ITEM.updatedAt }],
    ["a non-string note", { operatorNote: 5, expectedUpdatedAt: ITEM.updatedAt }],
    ["a null status", { status: null, expectedUpdatedAt: ITEM.updatedAt }],
    ["a string approval", { updatesApproved: "true", expectedUpdatedAt: ITEM.updatedAt }],
    ["a null approval", { updatesApproved: null, expectedUpdatedAt: ITEM.updatedAt }],
    ["an approval without a token", { updatesApproved: true }],
  ])("rejects %s with INVALID_REQUEST", async (_, body) => {
    const store = fakeStore();
    await expectFailure(await update(store, "7", body), 400, { ok: false, code: "INVALID_REQUEST" });
    expect(store.update).not.toHaveBeenCalled();
  });

  it.each([
    [{ status: "done", expectedUpdatedAt: ITEM.updatedAt }, { status: "INVALID" }],
    [{ operatorNote: "a".repeat(501), expectedUpdatedAt: ITEM.updatedAt }, { operatorNote: "TOO_LONG" }],
    [{ operatorNote: "a\u0007b", expectedUpdatedAt: ITEM.updatedAt }, { operatorNote: "INVALID" }],
    [{ status: "hold", expectedUpdatedAt: "2026-11-19" }, { expectedUpdatedAt: "INVALID" }],
    [{ status: "hold", expectedUpdatedAt: "2026-11-19T00:00:00.000000Z" }, { expectedUpdatedAt: "INVALID" }],
  ])("rejects %j with VALIDATION_ERROR %j", async (body, fieldErrors) => {
    const store = fakeStore();
    await expectFailure(await update(store, "7", body), 400, { ok: false, code: "VALIDATION_ERROR", fieldErrors });
    expect(store.update).not.toHaveBeenCalled();
  });

  it.each([
    ["not_found", 404, "NOT_FOUND"],
    ["conflict", 409, "CONFLICT"],
  ] as const)("maps %s to %i", async (kind, status, code) => {
    const store = fakeStore({ update: vi.fn(async () => ({ kind })) });
    await expectFailure(await update(store, "7", { status: "hold", expectedUpdatedAt: ITEM.updatedAt }), status, {
      ok: false,
      code,
    });
  });

  it("answers 503 when the update fails, without logging the note", async () => {
    const store = fakeStore({
      update: vi.fn(async () => {
        throw Object.assign(new Error(NOTE), { code: "ECONNRESET" });
      }),
    });
    await expectFailure(await update(store, "7", { operatorNote: NOTE, expectedUpdatedAt: ITEM.updatedAt }), 503, {
      ok: false,
      code: "UNAVAILABLE",
    });
  });

  it("answers 500 for unexpected errors", async () => {
    const handler = createUpdateHandler({
      ...options(fakeStore()),
      getAllowedOrigin: () => {
        throw new Error("boom");
      },
    });
    const response = await handler(request("PATCH", { status: "hold", expectedUpdatedAt: ITEM.updatedAt }), {
      params: Promise.resolve({ id: "7" }),
    });
    await expectFailure(response, 500, { ok: false, code: "INTERNAL_ERROR" });
  });
});
