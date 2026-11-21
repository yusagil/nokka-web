// @vitest-environment node
import { generateKeyPairSync, randomUUID, sign, type KeyObject } from "node:crypto";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import type { DigestMail, SendResult } from "@/lib/notifications/mailer";
import { registerMessage, sessionMessage } from "../crypto";
import {
  createChallengeHandler,
  createRegistrationHandler,
  createSessionHandler,
  readRegistrationConfig,
  type ChallengeServices,
  type RegistrationServices,
} from "../handlers";
import type { RegistrationStore } from "../store";

vi.mock("server-only", () => ({}));

const ORIGIN = "https://nokka-web.vercel.app";
const EMAIL = "nokka-updates-qa@example.com";
const EXPIRES = "2026-11-21T00:10:00.000Z";
const CODE = "01234567";

function newKey() {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" });
  const point = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, "base64url"), Buffer.from(jwk.y!, "base64url")]);
  return { point, privateKey, publicKey: point.toString("base64url") };
}
const signed = (key: KeyObject, message: string) =>
  sign("sha256", Buffer.from(message), { key, dsaEncoding: "ieee-p1363" }).toString("base64url");

const mac = newKey();
const installationId = randomUUID();
const challengeId = randomUUID();

function fakeStore(overrides: Partial<RegistrationStore> = {}): RegistrationStore {
  return {
    issueChallenge: vi.fn(async () => ({ challengeId, expiresAt: EXPIRES, delivery: null })),
    recordMail: vi.fn(async () => {}),
    findChallenge: vi.fn(async () => ({ applicationId: "7", installationId, publicKey: mac.point })),
    register: vi.fn(async () => ({ kind: "registered" as const })),
    findInstallation: vi.fn(async () => ({ applicationId: "7", publicKey: mac.point })),
    createSession: vi.fn(async () => ({ kind: "issued" as const, expiresAt: EXPIRES })),
    ...overrides,
  };
}

function fakeSender(result: SendResult = { outcome: "accepted", messageId: "18c1f0a2b3c4d5e6" }) {
  const send = vi.fn<(to: string, mail: DigestMail) => Promise<SendResult>>(async () => result);
  return { send, authorize: vi.fn(async () => ({ ok: true as const, send })) };
}

function services(store = fakeStore(), sender = fakeSender()): ChallengeServices {
  return { store, sender, rateLimiter: { consume: vi.fn(async () => ({ allowed: true as const })) }, origin: ORIGIN };
}

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/updates/v1/x", {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": "198.51.100.7", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

async function expectFailure(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual({ ok: false, code });
}

const challengeBody = { email: EMAIL, installationId, publicKey: mac.publicKey };

let logs: ReturnType<typeof vi.spyOn>[];
beforeEach(() => {
  logs = [vi.spyOn(console, "error").mockImplementation(() => {}), vi.spyOn(console, "warn").mockImplementation(() => {})];
});
afterEach(() => {
  // Nothing submitted (email, code, keys, tokens) ever reaches the logs.
  const logged = JSON.stringify(logs.flatMap((spy) => spy.mock.calls));
  for (const secret of [EMAIL, CODE, mac.publicKey]) expect(logged).not.toContain(secret);
  vi.restoreAllMocks();
});

describe("POST /api/updates/v1/challenges", () => {
  const handler = (svc: ChallengeServices | null, minResponseMs = 0) =>
    createChallengeHandler({ getServices: () => svc, minResponseMs });

  it("mails the code to the stored address after the challenge is committed, then records the result", async () => {
    const store = fakeStore({
      issueChallenge: vi.fn(async () => ({
        challengeId,
        expiresAt: EXPIRES,
        delivery: { to: "Stored.Address@example.com", code: CODE },
      })),
    });
    const sender = fakeSender();
    const response = await handler(services(store, sender))(post({ ...challengeBody, email: `  ${EMAIL} ` }));

    expect(response.status).toBe(202);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ ok: true, challengeId, expiresAt: EXPIRES });
    expect(store.issueChallenge).toHaveBeenCalledExactlyOnceWith({ email: EMAIL, installationId, publicKey: mac.point });
    expect(sender.send).toHaveBeenCalledOnce();
    const [to, mail] = sender.send.mock.calls[0];
    expect(to).toBe("Stored.Address@example.com");
    expect(mail.text).toContain(CODE);
    expect(mail.subject).not.toContain(CODE);
    expect(store.recordMail).toHaveBeenCalledExactlyOnceWith(challengeId, { outcome: "accepted", messageId: "18c1f0a2b3c4d5e6" });
    expect(vi.mocked(store.issueChallenge).mock.invocationCallOrder[0]).toBeLessThan(
      sender.send.mock.invocationCallOrder[0],
    );
  });

  it("answers the same way without sending anything when no code is due", async () => {
    const sender = fakeSender();
    const store = fakeStore();
    const response = await handler(services(store, sender))(post(challengeBody));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ ok: true, challengeId, expiresAt: EXPIRES });
    expect(sender.authorize).toHaveBeenCalledOnce();
    expect(sender.send).not.toHaveBeenCalled();
    expect(store.recordMail).not.toHaveBeenCalled();
  });

  it.each<SendResult>([
    { outcome: "rejected", code: "gmail_send_400_invalidArgument" },
    { outcome: "uncertain", code: "gmail_send_timeout" },
  ])("still answers 202 when the mail is $outcome and records it once without resending", async (result) => {
    const store = fakeStore({
      issueChallenge: vi.fn(async () => ({ challengeId, expiresAt: EXPIRES, delivery: { to: EMAIL, code: CODE } })),
    });
    const sender = fakeSender(result);
    const response = await handler(services(store, sender))(post(challengeBody));
    expect(response.status).toBe(202);
    expect(sender.send).toHaveBeenCalledOnce();
    expect(store.recordMail).toHaveBeenCalledExactlyOnceWith(challengeId, result);
  });

  it("answers 202 even when the mail result cannot be recorded", async () => {
    const store = fakeStore({
      issueChallenge: vi.fn(async () => ({ challengeId, expiresAt: EXPIRES, delivery: { to: EMAIL, code: CODE } })),
      recordMail: vi.fn(async () => {
        throw Object.assign(new Error(EMAIL), { code: "ECONNRESET" });
      }),
    });
    expect((await handler(services(store))(post(challengeBody))).status).toBe(202);
  });

  it("answers 503 for every email, before touching the store, when mail access fails", async () => {
    const store = fakeStore();
    const sender = { authorize: vi.fn(async () => ({ ok: false as const, code: "gmail_token_400_invalid_grant" })) };
    await expectFailure(await handler(services(store, sender as never))(post(challengeBody)), 503, "UNAVAILABLE");
    expect(store.issueChallenge).not.toHaveBeenCalled();
  });

  it("answers 503 when not configured or when the store fails", async () => {
    await expectFailure(await handler(null)(post(challengeBody)), 503, "UNAVAILABLE");
    const store = fakeStore({
      issueChallenge: vi.fn(async () => {
        throw Object.assign(new Error(EMAIL), { code: "57P01" });
      }),
    });
    await expectFailure(await handler(services(store))(post(challengeBody)), 503, "UNAVAILABLE");
  });

  it("answers 429 with Retry-After from the IP limit, before mail access", async () => {
    const svc = services();
    svc.rateLimiter.consume = vi.fn(async () => ({ allowed: false as const, retryAfterSeconds: 321 }));
    const response = await handler(svc)(post(challengeBody));
    await expectFailure(response.clone(), 429, "RATE_LIMITED");
    expect(response.headers.get("retry-after")).toBe("321");
    expect(svc.sender.authorize).not.toHaveBeenCalled();
    expect(svc.rateLimiter.consume).toHaveBeenCalledWith("198.51.100.7");
  });

  it("pads every answer after validation to the common response time", async () => {
    const sleep = vi.fn(async () => {});
    let clock = 1000;
    const now = () => clock;
    const store = fakeStore({
      issueChallenge: vi.fn(async () => {
        clock += 300;
        return { challengeId, expiresAt: EXPIRES, delivery: null };
      }),
    });
    const run = createChallengeHandler({ getServices: () => services(store), minResponseMs: 2000, now, sleep });
    expect((await run(post(challengeBody))).status).toBe(202);
    expect(sleep).toHaveBeenCalledExactlyOnceWith(1700);
    sleep.mockClear();
    await expectFailure(
      await createChallengeHandler({ getServices: () => null, minResponseMs: 2000, now, sleep })(post(challengeBody)),
      503,
      "UNAVAILABLE",
    );
    expect(sleep).toHaveBeenCalledExactlyOnceWith(2000);
  });

  it.each([
    ["a missing field", { email: EMAIL, installationId }],
    ["an extra field", { ...challengeBody, name: "QA" }],
    ["an invalid email", { ...challengeBody, email: "not-an-email" }],
    ["an upper-case installation id", { ...challengeBody, installationId: installationId.toUpperCase() }],
    ["a non-v4 installation id", { ...challengeBody, installationId: "0f1e2d3c-4b5a-1968-8776-a5b4c3d2e1f0" }],
    ["a padded key", { ...challengeBody, publicKey: `${mac.publicKey}=` }],
    ["a key off the curve", { ...challengeBody, publicKey: Buffer.alloc(65, 4).toString("base64url") }],
    ["a JSON array", [challengeBody]],
    ["malformed JSON", "{"],
  ])("rejects %s with 400 INVALID_REQUEST", async (_, body) => {
    const svc = services();
    await expectFailure(await handler(svc)(post(body)), 400, "INVALID_REQUEST");
    expect(svc.store.issueChallenge).not.toHaveBeenCalled();
  });

  it("rejects a non-JSON content type and an oversized body", async () => {
    await expectFailure(
      await handler(services())(post(challengeBody, { "content-type": "text/plain" })),
      400,
      "INVALID_REQUEST",
    );
    await expectFailure(
      await handler(services())(post({ ...challengeBody, email: `${"a".repeat(5000)}@example.com` })),
      400,
      "INVALID_REQUEST",
    );
  });

  it("accepts a request without an Origin header (native app)", async () => {
    const request = post(challengeBody);
    expect(request.headers.get("origin")).toBeNull();
    expect((await handler(services())(request)).status).toBe(202);
  });
});

describe("POST /api/updates/v1/registrations", () => {
  const handler = (svc: RegistrationServices | null) => createRegistrationHandler({ getServices: () => svc });
  const body = (overrides: Record<string, unknown> = {}, key = mac.privateKey) => {
    const fields = { challengeId, installationId, code: CODE, ...overrides };
    const message = registerMessage(ORIGIN, fields.challengeId as string, fields.installationId as string, fields.code as string);
    return { ...fields, signature: signed(key, message), ...overrides };
  };

  it("registers after verifying the requesting installation's signature", async () => {
    const store = fakeStore();
    const response = await handler(services(store))(post(body()));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ ok: true, installationId });
    expect(store.register).toHaveBeenCalledExactlyOnceWith({ challengeId, installationId, code: CODE });
  });

  it("never uses up an attempt for a proof from another key or origin", async () => {
    const store = fakeStore();
    await expectFailure(await handler(services(store))(post(body({}, newKey().privateKey))), 400, "INVALID_CHALLENGE");
    const otherOrigin = signed(mac.privateKey, registerMessage("http://localhost:3000", challengeId, installationId, CODE));
    await expectFailure(await handler(services(store))(post(body({ signature: otherOrigin }))), 400, "INVALID_CHALLENGE");
    expect(store.register).not.toHaveBeenCalled();
  });

  it("answers INVALID_CHALLENGE for unknown, other-installation and rejected challenges alike", async () => {
    await expectFailure(
      await handler(services(fakeStore({ findChallenge: vi.fn(async () => null) })))(post(body())),
      400,
      "INVALID_CHALLENGE",
    );
    const otherInstallation = randomUUID();
    const store = fakeStore();
    await expectFailure(
      await handler(services(store))(post(body({ installationId: otherInstallation }))),
      400,
      "INVALID_CHALLENGE",
    );
    expect(store.register).not.toHaveBeenCalled();
    await expectFailure(
      await handler(services(fakeStore({ register: vi.fn(async () => ({ kind: "invalid" as const })) })))(post(body())),
      400,
      "INVALID_CHALLENGE",
    );
  });

  it.each([
    ["a numeric code", { code: 1234567 }],
    ["a seven-digit code", { code: "1234567" }],
    ["a short signature", { signature: "AAAA" }],
    ["an upper-case challenge id", { challengeId: challengeId.toUpperCase() }],
  ])("rejects %s with INVALID_REQUEST", async (_, overrides) => {
    const svc = services();
    await expectFailure(await handler(svc)(post({ ...body(), ...overrides })), 400, "INVALID_REQUEST");
    expect(svc.store.findChallenge).not.toHaveBeenCalled();
  });

  it("answers 503 on database errors and when unconfigured, and 429 when limited", async () => {
    await expectFailure(await handler(null)(post(body())), 503, "UNAVAILABLE");
    const failing = fakeStore({
      register: vi.fn(async () => {
        throw Object.assign(new Error("boom"), { code: "40P01" });
      }),
    });
    await expectFailure(await handler(services(failing))(post(body())), 503, "UNAVAILABLE");
    const svc = services();
    svc.rateLimiter.consume = vi.fn(async () => ({ allowed: false as const, retryAfterSeconds: 5 }));
    await expectFailure(await handler(svc)(post(body())), 429, "RATE_LIMITED");
  });
});

describe("POST /api/updates/v1/sessions", () => {
  const NOW = 1_795_622_400_000;
  const handler = (svc: RegistrationServices | null) =>
    createSessionHandler({ getServices: () => svc, now: () => NOW });
  const nonce = Buffer.alloc(32, 7).toString("base64url");
  const body = (overrides: Record<string, unknown> = {}, key = mac.privateKey) => {
    const fields = { installationId, issuedAt: NOW / 1000, nonce, ...overrides };
    const message = sessionMessage(ORIGIN, fields.installationId as string, fields.issuedAt as number, fields.nonce as string);
    return { ...fields, signature: signed(key, message), ...overrides };
  };

  it("issues a 15-minute token after a valid proof", async () => {
    const store = fakeStore();
    const response = await handler(services(store))(post(body()));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const result = await response.json();
    expect(result).toMatchObject({ ok: true, expiresAt: EXPIRES });
    expect(result.accessToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const [input] = vi.mocked(store.createSession).mock.calls[0];
    expect(input).toMatchObject({ installationId, applicationId: "7" });
    // Only digests reach the store.
    expect(input.tokenHash).toHaveLength(32);
    expect(input.tokenHash.toString("base64url")).not.toBe(result.accessToken);
    expect(input.nonceDigest).toHaveLength(32);
  });

  it.each([
    ["120 seconds early", -120, 200],
    ["120 seconds late", 120, 200],
    ["121 seconds early", -121, 401],
    ["121 seconds late", 121, 401],
  ])("accepts or rejects a proof %s", async (_, offset, status) => {
    const response = await handler(services())(post(body({ issuedAt: NOW / 1000 + offset })));
    expect(response.status).toBe(status);
  });

  it("rejects forged proofs without consuming the nonce", async () => {
    const store = fakeStore();
    await expectFailure(await handler(services(store))(post(body({}, newKey().privateKey))), 401, "INVALID_PROOF");
    expect(store.createSession).not.toHaveBeenCalled();
  });

  it("maps replayed nonces to 401 and inactive or unknown installations to 403", async () => {
    await expectFailure(
      await handler(services(fakeStore({ createSession: vi.fn(async () => ({ kind: "replayed" as const })) })))(post(body())),
      401,
      "INVALID_PROOF",
    );
    await expectFailure(
      await handler(services(fakeStore({ createSession: vi.fn(async () => ({ kind: "inactive" as const })) })))(post(body())),
      403,
      "REGISTRATION_INACTIVE",
    );
    await expectFailure(
      await handler(services(fakeStore({ findInstallation: vi.fn(async () => null) })))(post(body())),
      403,
      "REGISTRATION_INACTIVE",
    );
  });

  it.each([
    ["a fractional issuedAt", { issuedAt: 1795622400.5 }],
    ["a string issuedAt", { issuedAt: "1795622400" }],
    ["a short nonce", { nonce: Buffer.alloc(16).toString("base64url") }],
  ])("rejects %s with INVALID_REQUEST", async (_, overrides) => {
    await expectFailure(await handler(services())(post({ ...body(), ...overrides })), 400, "INVALID_REQUEST");
  });

  it("answers 503 when the store fails", async () => {
    const store = fakeStore({
      createSession: vi.fn(async () => {
        throw Object.assign(new Error("boom"), { code: "ECONNREFUSED" });
      }),
    });
    await expectFailure(await handler(services(store))(post(body())), 503, "UNAVAILABLE");
  });
});

describe("configuration", () => {
  const secret = "x".repeat(32);

  it("needs a 32-character secret and defaults to the production origin", () => {
    expect(readRegistrationConfig({})).toBeNull();
    expect(readRegistrationConfig({ UPDATE_REGISTRATION_SECRET: "x".repeat(31) })).toBeNull();
    expect(readRegistrationConfig({ UPDATE_REGISTRATION_SECRET: secret })).toEqual({ secret, origin: ORIGIN });
  });

  it.each([
    ["http://localhost:3000", "http://localhost:3000"],
    ["https://preview.example.com/", "https://preview.example.com"],
    ["https://preview.example.com/path", null],
    ["ftp://example.com", null],
    ["not a url", null],
  ])("reads UPDATES_SIGNING_ORIGIN %s as %s", (value, expected) => {
    const config = readRegistrationConfig({ UPDATE_REGISTRATION_SECRET: secret, UPDATES_SIGNING_ORIGIN: value });
    expect(config?.origin ?? null).toBe(expected);
  });
});
