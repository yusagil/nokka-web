import "server-only";
import { getDatabase } from "@/lib/applications/db";
import { createRateLimiter, type RateLimiter } from "@/lib/applications/rate-limit";
import { validateEmail } from "@/lib/applications/validation";
import { createGmailSender, type MailSender } from "@/lib/notifications/mailer";
import { asObjectWithKeys, isJsonContentType, readJsonBody } from "@/lib/server/json-request";
import {
  DEFAULT_SIGNING_ORIGIN,
  MAX_BODY_BYTES,
  SESSION_CLOCK_SKEW_SECONDS,
  type ChallengeResponse,
  type RegistrationResponse,
  type SessionResponse,
  type UpdatesErrorCode,
  type UpdatesFailure,
} from "./contracts";
import {
  decodeBase64url,
  importPublicKey,
  isCode,
  isUuidV4,
  newAccessToken,
  NONCE_BYTES,
  PUBLIC_KEY_BYTES,
  registerMessage,
  sessionMessage,
  sha256,
  SIGNATURE_BYTES,
  verifySignature,
} from "./crypto";
import { composeCodeMail } from "./mail";
import { createRegistrationStore, type RegistrationStore } from "./store";

/** Database, secret and signing origin: enough for registrations and sessions. */
export type RegistrationServices = {
  store: RegistrationStore;
  /** Consumes one request for this endpoint's client key (already prefixed per endpoint). */
  rateLimiter: RateLimiter;
  /** The origin line the app signs (https://nokka-web.vercel.app in production). */
  origin: string;
};

/** Code requests also need mail access. */
export type ChallengeServices = RegistrationServices & { sender: MailSender };

export type HandlerOptions<Services> = {
  /** Null when not configured; the API then answers 503 to every request. */
  getServices?: () => Services | null;
  /** Upper bound for each database step. */
  timeoutMs?: number;
  now?: () => number;
};

export type ChallengeHandlerOptions = HandlerOptions<ChallengeServices> & {
  /**
   * Every answer after input validation takes at least this long, so the time a request takes doesn't
   * tell whether a code was mailed.
   */
  minResponseMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

const LOG_PREFIX = "[updates]";
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;
const MIN_SECRET_LENGTH = 32;
/** Per client IP and endpoint, in the shared 10-minute rate-limit window. */
export const IP_LIMITS = { challenges: 10, registrations: 30, sessions: 60 } as const;

/** POST /api/updates/v1/challenges */
export function createChallengeHandler({
  getServices = getConfiguredChallengeServices,
  timeoutMs = 8000,
  minResponseMs = 2000,
  now = Date.now,
  sleep = defaultSleep,
}: ChallengeHandlerOptions = {}) {
  return withErrorBoundary(async (request: Request) => {
    const fields = await readFields(request, ["email", "installationId", "publicKey"]);
    if (!fields) return failure(400, "INVALID_REQUEST");
    const { email, installationId, publicKey } = fields;
    const trimmedEmail = typeof email === "string" ? email.trim() : "";
    const point = decodeBase64url(publicKey, PUBLIC_KEY_BYTES);
    if (validateEmail(trimmedEmail) || !isUuidV4(installationId) || !point || !importPublicKey(point)) {
      return failure(400, "INVALID_REQUEST");
    }

    const started = now();
    const answer = async (response: Response) => {
      const wait = started + minResponseMs - now();
      if (wait > 0) await sleep(wait);
      return response;
    };

    const services = getServices();
    if (!services) return answer(unavailable("not configured"));
    let limit;
    try {
      limit = await withTimeout(timeoutMs, () => services.rateLimiter.consume(getClientKey(request.headers)));
    } catch (error) {
      return answer(unavailable("rate limit failed", error));
    }
    if (!limit.allowed) {
      return failure(429, "RATE_LIMITED", { "Retry-After": String(limit.retryAfterSeconds) });
    }

    // Mail access is checked for every request, allowed email or not, so a broken mail setup answers
    // 503 for everyone instead of only for allowed addresses.
    const access = await services.sender.authorize();
    if (!access.ok) return answer(unavailable(`mail access failed: ${access.code}`));

    let issued;
    try {
      issued = await withTimeout(timeoutMs, () =>
        services.store.issueChallenge({ email: trimmedEmail, installationId, publicKey: point }),
      );
    } catch (error) {
      return answer(unavailable("challenge failed", error));
    }

    // Sent only after the challenge is committed, to the stored address of the allowed request. The
    // app always gets the same answer: an undelivered code is not reported per address.
    if (issued.delivery) {
      const result = await access.send(issued.delivery.to, composeCodeMail(issued.delivery.code));
      if (result.outcome !== "accepted") console.warn(LOG_PREFIX, "code mail not accepted", { code: result.code });
      try {
        await withTimeout(timeoutMs, () => services.store.recordMail(issued.challengeId, result));
      } catch (error) {
        console.error(LOG_PREFIX, "mail result not recorded", describeError(error));
      }
    }

    const body: ChallengeResponse = { ok: true, challengeId: issued.challengeId, expiresAt: issued.expiresAt };
    return answer(respond(202, body));
  });
}

/** POST /api/updates/v1/registrations */
export function createRegistrationHandler({
  getServices = getConfiguredRegistrationServices("registrations"),
  timeoutMs = 8000,
}: HandlerOptions<RegistrationServices> = {}) {
  return withErrorBoundary(async (request: Request) => {
    const fields = await readFields(request, ["challengeId", "installationId", "code", "signature"]);
    if (!fields) return failure(400, "INVALID_REQUEST");
    const { challengeId, installationId, code } = fields;
    const signature = decodeBase64url(fields.signature, SIGNATURE_BYTES);
    if (!isUuidV4(challengeId) || !isUuidV4(installationId) || !isCode(code) || !signature) {
      return failure(400, "INVALID_REQUEST");
    }

    const services = getServices();
    if (!services) return unavailable("not configured");
    try {
      const limit = await withTimeout(timeoutMs, () =>
        services.rateLimiter.consume(getClientKey(request.headers)),
      );
      if (!limit.allowed) {
        return failure(429, "RATE_LIMITED", { "Retry-After": String(limit.retryAfterSeconds) });
      }

      // Wrong, expired, reused, superseded or someone else's: all the same answer.
      const challenge = await withTimeout(timeoutMs, () => services.store.findChallenge(challengeId));
      if (!challenge || challenge.installationId !== installationId) return failure(400, "INVALID_CHALLENGE");
      // Only a proof from the requesting installation's key may use up an attempt.
      const message = registerMessage(services.origin, challengeId, installationId, code);
      if (!verifySignature(challenge.publicKey, message, signature)) return failure(400, "INVALID_CHALLENGE");

      const outcome = await withTimeout(timeoutMs, () =>
        services.store.register({ challengeId, installationId, code }),
      );
      if (outcome.kind !== "registered") return failure(400, "INVALID_CHALLENGE");
    } catch (error) {
      return unavailable("registration failed", error);
    }
    const body: RegistrationResponse = { ok: true, installationId };
    return respond(200, body);
  });
}

/** POST /api/updates/v1/sessions */
export function createSessionHandler({
  getServices = getConfiguredRegistrationServices("sessions"),
  timeoutMs = 8000,
  now = Date.now,
}: HandlerOptions<RegistrationServices> = {}) {
  return withErrorBoundary(async (request: Request) => {
    const fields = await readFields(request, ["installationId", "issuedAt", "nonce", "signature"]);
    if (!fields) return failure(400, "INVALID_REQUEST");
    const { installationId, issuedAt, nonce } = fields;
    const nonceBytes = decodeBase64url(nonce, NONCE_BYTES);
    const signature = decodeBase64url(fields.signature, SIGNATURE_BYTES);
    if (
      !isUuidV4(installationId) ||
      typeof issuedAt !== "number" ||
      !Number.isSafeInteger(issuedAt) ||
      issuedAt < 0 ||
      !nonceBytes ||
      !signature
    ) {
      return failure(400, "INVALID_REQUEST");
    }

    const services = getServices();
    if (!services) return unavailable("not configured");
    let outcome;
    try {
      const limit = await withTimeout(timeoutMs, () =>
        services.rateLimiter.consume(getClientKey(request.headers)),
      );
      if (!limit.allowed) {
        return failure(429, "RATE_LIMITED", { "Retry-After": String(limit.retryAfterSeconds) });
      }

      const installation = await withTimeout(timeoutMs, () => services.store.findInstallation(installationId));
      if (!installation) return failure(403, "REGISTRATION_INACTIVE");
      if (Math.abs(now() / 1000 - issuedAt) > SESSION_CLOCK_SKEW_SECONDS) return failure(401, "INVALID_PROOF");
      const message = sessionMessage(services.origin, installationId, issuedAt, nonce as string);
      if (!verifySignature(installation.publicKey, message, signature)) return failure(401, "INVALID_PROOF");

      const token = newAccessToken();
      outcome = await withTimeout(timeoutMs, () =>
        services.store.createSession({
          installationId,
          applicationId: installation.applicationId,
          nonceDigest: sha256(nonceBytes),
          tokenHash: sha256(token),
        }),
      );
      if (outcome.kind === "inactive") return failure(403, "REGISTRATION_INACTIVE");
      if (outcome.kind === "replayed") return failure(401, "INVALID_PROOF");
      const body: SessionResponse = { ok: true, accessToken: token, expiresAt: outcome.expiresAt };
      return respond(200, body);
    } catch (error) {
      return unavailable("session failed", error);
    }
  });
}

/** Configuration shared by the three endpoints; null (503) while anything is missing or malformed. */
export function readRegistrationConfig(env: Record<string, string | undefined> = process.env) {
  const secret = readEnv(env, "UPDATE_REGISTRATION_SECRET");
  if (!secret || secret.length < MIN_SECRET_LENGTH) return null;
  const origin = readOrigin(readEnv(env, "UPDATES_SIGNING_ORIGIN") ?? DEFAULT_SIGNING_ORIGIN);
  if (!origin) return null;
  return { secret, origin };
}

function getConfiguredRegistrationServices(endpoint: keyof typeof IP_LIMITS) {
  return (): RegistrationServices | null => {
    const config = readRegistrationConfig();
    const sql = getDatabase();
    if (!config || !sql) return null;
    const limiter = createRateLimiter(sql, config.secret, { limit: IP_LIMITS[endpoint] });
    return {
      store: createRegistrationStore(sql, config.secret),
      rateLimiter: { consume: (clientKey) => limiter.consume(`updates/${endpoint}:${clientKey}`) },
      origin: config.origin,
    };
  };
}

function getConfiguredChallengeServices(): ChallengeServices | null {
  const base = getConfiguredRegistrationServices("challenges")();
  const clientId = readEnv(process.env, "GMAIL_CLIENT_ID");
  const clientSecret = readEnv(process.env, "GMAIL_CLIENT_SECRET");
  const refreshToken = readEnv(process.env, "GMAIL_REFRESH_TOKEN");
  const from = readEnv(process.env, "UPDATE_CODE_MAIL_FROM");
  if (!base || !clientId || !clientSecret || !refreshToken || !from) return null;
  // No token retries and short timeouts: the app is waiting, and a failed code request can be repeated.
  const sender = createGmailSender({ clientId, clientSecret, refreshToken, from, tokenRetryDelaysMs: [], timeoutMs: 5000 });
  return { ...base, sender };
}

function readEnv(env: Record<string, string | undefined>, name: string): string | null {
  const value = env[name]?.trim();
  return value && !CONTROL_CHARACTERS.test(value) ? value : null;
}

function readOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin === value.replace(/\/$/, "") ? url.origin : null;
  } catch {
    return null;
  }
}

/** The exact JSON object with these keys (all required), or null for anything malformed. */
async function readFields(request: Request, keys: readonly string[]) {
  if (!isJsonContentType(request.headers.get("content-type"))) return null;
  const body = await readJsonBody(request, MAX_BODY_BYTES);
  if (!body.ok) return null;
  const fields = asObjectWithKeys(body.value, keys);
  if (!fields || keys.some((key) => !(key in fields))) return null;
  return fields;
}

/** Client IP as set by the hosting proxy (Vercel overwrites both headers). */
function getClientKey(headers: Headers): string {
  const ip = headers.get("x-real-ip") ?? headers.get("x-forwarded-for")?.split(",")[0];
  return ip?.trim() || "unknown";
}

async function withTimeout<T>(ms: number, run: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Timed out")), ms);
  });
  try {
    return await Promise.race([run(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function withErrorBoundary(handle: (request: Request) => Promise<Response>) {
  return async (request: Request): Promise<Response> => {
    try {
      return await handle(request);
    } catch (error) {
      console.error(LOG_PREFIX, "unexpected error", describeError(error));
      return failure(500, "INTERNAL_ERROR");
    }
  };
}

function unavailable(reason: string, error?: unknown) {
  console.error(LOG_PREFIX, reason, error === undefined ? "" : describeError(error));
  return failure(503, "UNAVAILABLE");
}

/** Error class and code only: messages can contain submitted values. */
function describeError(error: unknown) {
  if (!(error instanceof Error)) return { name: typeof error };
  const code = (error as { code?: unknown }).code;
  return { name: error.name, code: typeof code === "string" ? code : undefined };
}

function failure(status: number, code: UpdatesErrorCode, headers?: Record<string, string>) {
  const body: UpdatesFailure = { ok: false, code };
  return respond(status, body, headers);
}

function respond(
  status: number,
  body: ChallengeResponse | RegistrationResponse | SessionResponse | UpdatesFailure,
  headers?: Record<string, string>,
) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store", ...headers } });
}

function defaultSleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
