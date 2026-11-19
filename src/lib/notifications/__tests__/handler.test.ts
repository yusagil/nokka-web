// @vitest-environment node
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import type { DigestRunResult, DigestServices } from "../digest";
import { createApplicationDigestHandler, type DigestHandlerOptions } from "../handler";

vi.mock("server-only", () => ({}));
const getDatabase = vi.hoisted(() => vi.fn(() => null));
vi.mock("@/lib/applications/db", () => ({ getDatabase }));

const SECRET = "test-cron-secret-0123456789";
const ENDPOINT = "http://localhost/api/cron/application-digest";
const SERVICES = {} as DigestServices;

const get = (authorization?: string) =>
  new Request(ENDPOINT, { headers: authorization ? { authorization } : {} });

function setup(result: DigestRunResult | Error, options: DigestHandlerOptions = {}) {
  const runDigest = vi.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  const getServices = vi.fn(() => SERVICES);
  const handler = createApplicationDigestHandler({
    getCronSecret: () => SECRET,
    getServices,
    runDigest,
    ...options,
  });
  return { handler, runDigest, getServices };
}

describe("GET /api/cron/application-digest", () => {
  let errors: ReturnType<typeof vi.spyOn>;
  const networkFetch = vi.fn(() => Promise.reject(new Error("real network is disabled in tests")));
  beforeEach(() => {
    errors = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", networkFetch);
  });
  afterEach(() => {
    expect(networkFetch).not.toHaveBeenCalled();
    errors.mockRestore();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    getDatabase.mockClear();
  });

  it("answers 200 with the run status and no-store", async () => {
    const { handler, runDigest } = setup({ ok: true, status: "sent", count: 3, mayRepeat: false });
    const response = await handler(get(`Bearer ${SECRET}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: true, status: "sent", count: 3 });
    expect(runDigest).toHaveBeenCalledWith(SERVICES);
  });

  it.each(["skipped", "busy"] as const)("answers 200 %s with count 0", async (status) => {
    const { handler } = setup({ ok: true, status, count: 0 });
    expect(await (await handler(get(`Bearer ${SECRET}`))).json()).toEqual({ ok: true, status, count: 0 });
  });

  it.each([
    ["no header", undefined],
    ["wrong secret", "Bearer wrong-secret-0123456789"],
    ["secret prefix", `Bearer ${SECRET.slice(0, -1)}`],
    ["other scheme", `Basic ${SECRET}`],
    ["lower-case scheme", `bearer ${SECRET}`],
  ])("answers 401 for %s without touching mail or database", async (_label, authorization) => {
    const { handler, runDigest, getServices } = setup({ ok: true, status: "sent", count: 1, mayRepeat: false });
    const response = await handler(get(authorization));
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: false, code: "UNAUTHENTICATED" });
    expect(getServices).not.toHaveBeenCalled();
    expect(runDigest).not.toHaveBeenCalled();
  });

  it.each([
    ["unset", null],
    ["too short", "short-secret"],
  ])("fails closed with 503 when CRON_SECRET is %s", async (_label, secret) => {
    const { handler, runDigest, getServices } = setup(
      { ok: true, status: "sent", count: 1, mayRepeat: false },
      { getCronSecret: () => secret },
    );
    for (const authorization of [undefined, `Bearer ${secret}`, "Bearer "]) {
      const response = await handler(get(authorization));
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ ok: false, code: "UNAVAILABLE" });
    }
    expect(getServices).not.toHaveBeenCalled();
    expect(runDigest).not.toHaveBeenCalled();
  });

  it("reads CRON_SECRET from the environment and refuses when it is missing", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const handler = createApplicationDigestHandler({ getServices: () => SERVICES, runDigest: vi.fn() });
    expect((await handler(get("Bearer "))).status).toBe(503);

    vi.stubEnv("CRON_SECRET", SECRET);
    const runDigest = vi.fn(async (): Promise<DigestRunResult> => ({ ok: true, status: "busy", count: 0 }));
    const configured = createApplicationDigestHandler({ getServices: () => SERVICES, runDigest });
    expect((await configured(get(`Bearer ${SECRET}`))).status).toBe(200);
  });

  const MAIL_ENV = {
    GMAIL_CLIENT_ID: "client-id.apps.googleusercontent.com",
    GMAIL_CLIENT_SECRET: "client-secret",
    GMAIL_REFRESH_TOKEN: "refresh-token",
    APPLICATION_DIGEST_FROM: "owner@gmail.com",
    APPLICATION_DIGEST_TO: "owner@gmail.com",
  };

  it.each(Object.keys(MAIL_ENV))("answers 503 before any database access when %s is missing", async (name) => {
    vi.stubEnv("CRON_SECRET", SECRET);
    vi.stubEnv("DATABASE_URL", "postgres://unused@127.0.0.1:1/unused");
    for (const [key, value] of Object.entries(MAIL_ENV)) vi.stubEnv(key, key === name ? " " : value);
    const runDigest = vi.fn();
    const response = await createApplicationDigestHandler({ runDigest })(get(`Bearer ${SECRET}`));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, code: "UNAVAILABLE" });
    expect(getDatabase).not.toHaveBeenCalled();
    expect(runDigest).not.toHaveBeenCalled();
  });

  it("answers 503 when mail is configured but the database is not", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    for (const [key, value] of Object.entries(MAIL_ENV)) vi.stubEnv(key, value);
    const runDigest = vi.fn();
    const response = await createApplicationDigestHandler({ runDigest })(get(`Bearer ${SECRET}`));
    expect(response.status).toBe(503);
    expect(getDatabase).toHaveBeenCalledOnce();
    expect(runDigest).not.toHaveBeenCalled();
  });

  it.each([
    { ok: false, reason: "failed", code: "gmail_token_400_invalid_grant" },
    { ok: false, reason: "unknown", code: "gmail_send_timeout" },
  ] as const)("answers 503 when the digest was not confirmed as sent ($reason)", async (result) => {
    const { handler } = setup(result);
    const response = await handler(get(`Bearer ${SECRET}`));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, code: "UNAVAILABLE" });
    expect(errors).toHaveBeenCalledWith("[application-digest]", "digest not sent", {
      reason: result.reason,
      code: result.code,
    });
  });

  it("warns (without changing the response) when the digest may have been sent twice", async () => {
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { handler } = setup({ ok: true, status: "sent", count: 2, mayRepeat: true });
      const response = await handler(get(`Bearer ${SECRET}`));
      expect(await response.json()).toEqual({ ok: true, status: "sent", count: 2 });
      expect(warnings).toHaveBeenCalledWith(
        "[application-digest]",
        "digest sent again after an uncertain send; the admin may get it twice",
      );

      warnings.mockClear();
      await setup({ ok: true, status: "sent", count: 2, mayRepeat: false }).handler(get(`Bearer ${SECRET}`));
      expect(warnings).not.toHaveBeenCalled();
    } finally {
      warnings.mockRestore();
    }
  });

  it("answers 503 and logs only the error class and code when storage fails", async () => {
    const failure = Object.assign(new Error("connect to owner@example.com failed: secret"), { code: "ECONNREFUSED" });
    const { handler } = setup(failure);
    const response = await handler(get(`Bearer ${SECRET}`));
    expect(response.status).toBe(503);
    expect(errors).toHaveBeenCalledWith("[application-digest]", "digest failed", {
      name: "Error",
      code: "ECONNREFUSED",
    });
    expect(JSON.stringify(errors.mock.calls)).not.toContain("@");
    expect(JSON.stringify(errors.mock.calls)).not.toContain(SECRET);
  });

  it("answers 500 on an unexpected error", async () => {
    const handler = createApplicationDigestHandler({
      getCronSecret: () => SECRET,
      getServices: () => {
        throw new TypeError("bug");
      },
    });
    const response = await handler(get(`Bearer ${SECRET}`));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, code: "INTERNAL_ERROR" });
  });
});
