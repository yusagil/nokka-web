import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { getDatabase } from "@/lib/applications/db";
import { runApplicationDigest, type DigestRunResult, type DigestServices } from "./digest";
import { createDigestStore } from "./digest-store";
import { createGmailMailer } from "./mailer";

export type DigestResponse =
  | { ok: true; status: "sent" | "skipped" | "busy"; count: number }
  | { ok: false; code: "UNAUTHENTICATED" | "UNAVAILABLE" | "INTERNAL_ERROR" };

export type DigestHandlerOptions = {
  /** Null (or too short) when unset: every call is refused with 503. */
  getCronSecret?: () => string | null;
  /** Null when mail or the database is not configured; checked before any database access. */
  getServices?: () => DigestServices | null;
  runDigest?: (services: DigestServices) => Promise<DigestRunResult>;
};

const LOG_PREFIX = "[application-digest]";
const MIN_SECRET_LENGTH = 16;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;

/** GET /api/cron/application-digest, called by Vercel Cron with `Authorization: Bearer <CRON_SECRET>`. */
export function createApplicationDigestHandler({
  getCronSecret = () => readEnv("CRON_SECRET"),
  getServices = getConfiguredServices,
  runDigest = runApplicationDigest,
}: DigestHandlerOptions = {}) {
  async function handle(request: Request): Promise<Response> {
    const secret = getCronSecret();
    if (!secret || secret.length < MIN_SECRET_LENGTH) {
      console.error(LOG_PREFIX, "CRON_SECRET is not configured");
      return respond(503, { ok: false, code: "UNAVAILABLE" });
    }
    if (!isAuthorized(request.headers.get("authorization"), secret)) {
      return respond(401, { ok: false, code: "UNAUTHENTICATED" });
    }

    const services = getServices();
    if (!services) {
      console.error(LOG_PREFIX, "mail or database is not configured");
      return respond(503, { ok: false, code: "UNAVAILABLE" });
    }

    let result: DigestRunResult;
    try {
      result = await runDigest(services);
    } catch (error) {
      // Includes a mail the provider accepted but that could not be recorded: the batch stays
      // unfinished and the next day's call sends it again (the admin may get it twice).
      console.error(LOG_PREFIX, "digest failed", describeError(error));
      return respond(503, { ok: false, code: "UNAVAILABLE" });
    }
    if (!result.ok) {
      console.error(LOG_PREFIX, "digest not sent", { reason: result.reason, code: result.code });
      return respond(503, { ok: false, code: "UNAVAILABLE" });
    }
    if (result.status === "sent" && result.mayRepeat) {
      console.warn(LOG_PREFIX, "digest sent again after an uncertain send; the admin may get it twice");
    }
    return respond(200, { ok: true, status: result.status, count: result.count });
  }

  return async function GET(request: Request): Promise<Response> {
    try {
      return await handle(request);
    } catch (error) {
      console.error(LOG_PREFIX, "unexpected error", describeError(error));
      return respond(500, { ok: false, code: "INTERNAL_ERROR" });
    }
  };
}

function getConfiguredServices(): DigestServices | null {
  const clientId = readEnv("GMAIL_CLIENT_ID");
  const clientSecret = readEnv("GMAIL_CLIENT_SECRET");
  const refreshToken = readEnv("GMAIL_REFRESH_TOKEN");
  const from = readEnv("APPLICATION_DIGEST_FROM");
  const to = readEnv("APPLICATION_DIGEST_TO");
  if (!clientId || !clientSecret || !refreshToken || !from || !to) return null;
  const sql = getDatabase();
  if (!sql) return null;
  return {
    store: createDigestStore(sql),
    mailer: createGmailMailer({ clientId, clientSecret, refreshToken, from, to }),
  };
}

function readEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value && !CONTROL_CHARACTERS.test(value) ? value : null;
}

/** Compares digests so neither the secret's content nor its length leaks through timing. */
export function isAuthorized(header: string | null, secret: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const given = createHash("sha256").update(header.slice("Bearer ".length)).digest();
  const expected = createHash("sha256").update(secret).digest();
  return timingSafeEqual(given, expected);
}

/** Error class and code only. */
function describeError(error: unknown) {
  if (!(error instanceof Error)) return { name: typeof error };
  const code = (error as { code?: unknown }).code;
  return { name: error.name, code: typeof code === "string" ? code : undefined };
}

function respond(status: number, body: DigestResponse) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
