// @vitest-environment node
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import type { ApplicationRequest } from "../contracts";
import {
  createApplicationsHandler,
  type ApplicationServices,
  type ApplicationsHandlerOptions,
} from "../handler";
import type { RateLimitDecision } from "../rate-limit";
import type { SaveOutcome } from "../store";

vi.mock("server-only", () => ({}));

const SITE = "https://nokka-web.vercel.app";
const NAME = "QA 신청 테스트";
const EMAIL = "nokka-apply-qa-handler@example.com";

function fakeServices({
  save = async () => "created",
  consume = async () => ({ allowed: true }),
}: {
  save?: (application: ApplicationRequest) => Promise<SaveOutcome>;
  consume?: (key: string) => Promise<RateLimitDecision>;
} = {}) {
  const services = {
    store: { save: vi.fn(save) },
    rateLimiter: { consume: vi.fn(consume) },
  };
  return services satisfies ApplicationServices;
}

function setup(services: ApplicationServices | null, options: ApplicationsHandlerOptions = {}) {
  return createApplicationsHandler({
    getServices: () => services,
    getAllowedOrigins: () => new Set([SITE]),
    allowLocalOrigins: false,
    ...options,
  });
}

function post(
  body: BodyInit | null,
  { headers = {}, json = true }: { headers?: Record<string, string>; json?: boolean } = {},
) {
  return new Request("http://localhost/api/applications", {
    method: "POST",
    headers: {
      origin: SITE,
      ...(json ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body,
  });
}

const valid = () => JSON.stringify({ name: NAME, email: EMAIL });

async function expectError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ ok: false, code });
}

let logs: ReturnType<typeof vi.spyOn>[] = [];

beforeEach(() => {
  logs = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => {}),
  );
});

afterEach(() => {
  // No log line may carry submitted values, whatever the outcome.
  const logged = JSON.stringify(logs.flatMap((spy) => spy.mock.calls));
  expect(logged).not.toContain(EMAIL);
  expect(logged).not.toContain(NAME);
  vi.restoreAllMocks();
});

describe("POST /api/applications", () => {
  it("returns 200 only after the store saved the trimmed values", async () => {
    const services = fakeServices();
    const response = await setup(services)(
      post(JSON.stringify({ name: `  ${NAME} `, email: ` ${EMAIL}  ` })),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: true });
    expect(services.store.save).toHaveBeenCalledExactlyOnceWith({ name: NAME, email: EMAIL });
  });

  it("answers an already stored email exactly like a new one", async () => {
    const response = await setup(fakeServices({ save: async () => "existing" }))(post(valid()));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("accepts a JSON content type with a charset parameter", async () => {
    const response = await setup(fakeServices())(
      post(valid(), { headers: { "content-type": "application/json; charset=UTF-8" } }),
    );
    expect(response.status).toBe(200);
  });

  describe("origin", () => {
    it.each([
      ["missing", undefined],
      ["another site", "https://evil.example"],
      ["opaque", "null"],
      ["the site over http", "http://nokka-web.vercel.app"],
      ["localhost outside development", "http://localhost:3000"],
    ])("rejects a %s origin with 403", async (_, origin) => {
      const services = fakeServices();
      const request = post(valid());
      if (origin === undefined) request.headers.delete("origin");
      else request.headers.set("origin", origin);

      await expectError(await setup(services)(request), 403, "FORBIDDEN");
      expect(services.store.save).not.toHaveBeenCalled();
    });

    it("accepts extra configured origins and local origins when enabled", async () => {
      const handler = setup(fakeServices(), {
        getAllowedOrigins: () => new Set([SITE, "https://preview.example"]),
        allowLocalOrigins: true,
      });
      for (const origin of ["https://preview.example", "http://localhost:3000", "http://127.0.0.1:4010"]) {
        const response = await handler(post(valid(), { headers: { origin } }));
        expect(response.status, origin).toBe(200);
      }
    });
  });

  it("rejects non-JSON content types with 415", async () => {
    const services = fakeServices();
    for (const contentType of [undefined, "text/plain", "application/x-www-form-urlencoded"]) {
      const response = await setup(services)(
        post(valid(), { json: false, headers: contentType ? { "content-type": contentType } : {} }),
      );
      await expectError(response, 415, "UNSUPPORTED_MEDIA_TYPE");
    }
    expect(services.store.save).not.toHaveBeenCalled();
  });

  describe("body size", () => {
    const oversized = JSON.stringify({ name: NAME, email: EMAIL, pad: "x".repeat(9000) });

    it("rejects a declared Content-Length over 8 KiB with 413", async () => {
      const services = fakeServices();
      await expectError(await setup(services)(post(oversized)), 413, "PAYLOAD_TOO_LARGE");
      expect(services.store.save).not.toHaveBeenCalled();
    });

    it("rejects a streamed body over 8 KiB without Content-Length", async () => {
      const bytes = new TextEncoder().encode(oversized);
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (let i = 0; i < bytes.length; i += 1024) controller.enqueue(bytes.slice(i, i + 1024));
          controller.close();
        },
      });
      const request = new Request("http://localhost/api/applications", {
        method: "POST",
        headers: { origin: SITE, "content-type": "application/json" },
        body: stream,
        duplex: "half",
      } as RequestInit);
      expect(request.headers.get("content-length")).toBeNull();

      const services = fakeServices();
      await expectError(await setup(services)(request), 413, "PAYLOAD_TOO_LARGE");
      expect(services.store.save).not.toHaveBeenCalled();
    });
  });

  it.each([
    ["malformed JSON", "{"],
    ["an empty body", ""],
    ["an array", JSON.stringify([NAME, EMAIL])],
    ["null", "null"],
    ["a string", JSON.stringify("hello")],
    ["a missing field", JSON.stringify({ name: NAME })],
    ["a non-string field", JSON.stringify({ name: NAME, email: 42 })],
    ["an unsupported field", JSON.stringify({ name: NAME, email: EMAIL, locale: "ko" })],
  ])("rejects %s with 400 INVALID_REQUEST", async (_, body) => {
    const services = fakeServices();
    await expectError(await setup(services)(post(body)), 400, "INVALID_REQUEST");
    expect(services.store.save).not.toHaveBeenCalled();
  });

  it("rejects bytes that are not UTF-8 with 400 INVALID_REQUEST", async () => {
    const bytes = new Uint8Array([0x7b, 0x22, 0xff, 0xfe, 0x22, 0x7d]);
    await expectError(await setup(fakeServices())(post(bytes)), 400, "INVALID_REQUEST");
  });

  it("returns field errors without echoing the submitted values", async () => {
    const services = fakeServices();
    const response = await setup(services)(
      post(JSON.stringify({ name: "  ", email: "not-an-email" })),
    );

    expect(response.status).toBe(400);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({
      ok: false,
      code: "VALIDATION_ERROR",
      fieldErrors: { name: "REQUIRED", email: "INVALID" },
    });
    expect(text).not.toContain("not-an-email");
    expect(services.rateLimiter.consume).not.toHaveBeenCalled();
    expect(services.store.save).not.toHaveBeenCalled();
  });

  it("returns 429 with Retry-After and does not store when rate limited", async () => {
    const services = fakeServices({
      consume: async () => ({ allowed: false, retryAfterSeconds: 321 }),
    });
    const response = await setup(services)(post(valid()));

    await expectError(response, 429, "RATE_LIMITED");
    expect(response.headers.get("retry-after")).toBe("321");
    expect(services.store.save).not.toHaveBeenCalled();
  });

  it("keys the rate limit by the proxy-provided client IP", async () => {
    const services = fakeServices();
    const handler = setup(services);
    await handler(post(valid(), { headers: { "x-real-ip": "203.0.113.7" } }));
    await handler(post(valid(), { headers: { "x-forwarded-for": "198.51.100.2, 10.0.0.1" } }));
    await handler(post(valid()));

    expect(services.rateLimiter.consume.mock.calls).toEqual([
      ["203.0.113.7"],
      ["198.51.100.2"],
      ["unknown"],
    ]);
  });

  describe("storage failures never answer 2xx", () => {
    it("returns 503 when storage is not configured", async () => {
      await expectError(await setup(null)(post(valid())), 503, "UNAVAILABLE");
    });

    it("returns 503 when building the services fails", async () => {
      const handler = setup(null, {
        getServices: () => {
          throw new TypeError("Invalid URL");
        },
      });
      await expectError(await handler(post(valid())), 503, "UNAVAILABLE");
    });

    it("returns 503 when the rate limiter fails", async () => {
      const services = fakeServices({
        consume: async () => {
          throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
        },
      });
      await expectError(await setup(services)(post(valid())), 503, "UNAVAILABLE");
      expect(services.store.save).not.toHaveBeenCalled();
    });

    it("returns 503 when the insert fails, without logging error details", async () => {
      const services = fakeServices({
        save: async () => {
          throw Object.assign(new Error(`duplicate key (${EMAIL})`), {
            code: "23505",
            detail: `Key (email_normalized)=(${EMAIL}) already exists.`,
          });
        },
      });
      await expectError(await setup(services)(post(valid())), 503, "UNAVAILABLE");
      expect(console.error).toHaveBeenCalledWith("[applications]", "storage failed", {
        name: "Error",
        code: "23505",
      });
    });

    it("returns 503 when storage does not answer in time", async () => {
      const services = fakeServices({ save: () => new Promise<never>(() => {}) });
      const response = await setup(services, { timeoutMs: 20 })(post(valid()));
      await expectError(response, 503, "UNAVAILABLE");
    });
  });

  it("returns 500 for unexpected errors", async () => {
    const handler = setup(fakeServices(), {
      getAllowedOrigins: () => {
        throw new Error("boom");
      },
    });
    await expectError(await handler(post(valid())), 500, "INTERNAL_ERROR");
  });
});
