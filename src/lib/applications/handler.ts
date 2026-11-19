import "server-only";
import { SITE_URL } from "@/lib/links";
import {
  MAX_BODY_BYTES,
  type ApplicationErrorCode,
  type ApplicationRequest,
  type ApplicationResult,
  type FieldErrors,
} from "./contracts";
import { getDatabase } from "./db";
import { createRateLimiter, type RateLimiter } from "./rate-limit";
import { createApplicationStore, type ApplicationStore } from "./store";
import { validateApplication } from "./validation";

export type ApplicationServices = {
  store: ApplicationStore;
  rateLimiter: RateLimiter;
};

export type ApplicationsHandlerOptions = {
  /** Null when storage is not configured; the API then answers 503. */
  getServices?: () => ApplicationServices | null;
  getAllowedOrigins?: () => ReadonlySet<string>;
  /** Also accepts http://localhost:* and http://127.0.0.1:* origins. */
  allowLocalOrigins?: boolean;
  /** Upper bound for the rate-limit and storage round trips. */
  timeoutMs?: number;
};

const LOG_PREFIX = "[applications]";

/** Builds the POST /api/applications handler. Defaults read server-only environment variables. */
export function createApplicationsHandler({
  getServices = getConfiguredServices,
  getAllowedOrigins = getConfiguredOrigins,
  allowLocalOrigins = process.env.NODE_ENV === "development",
  timeoutMs = 8000,
}: ApplicationsHandlerOptions = {}) {
  async function handle(request: Request): Promise<Response> {
    const origin = request.headers.get("origin");
    if (!origin || !isAllowedOrigin(origin, getAllowedOrigins(), allowLocalOrigins)) {
      return failure(403, "FORBIDDEN");
    }
    if (!isJsonContentType(request.headers.get("content-type"))) {
      return failure(415, "UNSUPPORTED_MEDIA_TYPE");
    }

    const body = await readBody(request);
    if (body === TOO_LARGE) return failure(413, "PAYLOAD_TOO_LARGE");
    const input = body === null ? null : parseRequest(body);
    if (!input) return failure(400, "INVALID_REQUEST");

    const validation = validateApplication(input);
    if (!validation.ok) return failure(400, "VALIDATION_ERROR", validation.fieldErrors);

    let decision;
    try {
      const services = getServices();
      if (!services) {
        console.error(LOG_PREFIX, "storage is not configured");
        return failure(503, "UNAVAILABLE");
      }
      decision = await withTimeout(timeoutMs, async () => {
        const limit = await services.rateLimiter.consume(getClientKey(request.headers));
        if (limit.allowed) await services.store.save(validation.value);
        return limit;
      });
    } catch (error) {
      console.error(LOG_PREFIX, "storage failed", describeError(error));
      return failure(503, "UNAVAILABLE");
    }

    if (!decision.allowed) {
      return failure(429, "RATE_LIMITED", undefined, {
        "Retry-After": String(decision.retryAfterSeconds),
      });
    }
    return respond(200, { ok: true });
  }

  return async function POST(request: Request): Promise<Response> {
    try {
      return await handle(request);
    } catch (error) {
      console.error(LOG_PREFIX, "unexpected error", describeError(error));
      return failure(500, "INTERNAL_ERROR");
    }
  };
}

function getConfiguredServices(): ApplicationServices | null {
  const sql = getDatabase();
  const secret = process.env.APPLICATION_RATE_LIMIT_SECRET;
  if (!sql || !secret) return null;
  return { store: createApplicationStore(sql), rateLimiter: createRateLimiter(sql, secret) };
}

/** The public site plus exact origins from APPLICATION_ALLOWED_ORIGINS (comma-separated). */
function getConfiguredOrigins(): ReadonlySet<string> {
  const origins = new Set([new URL(SITE_URL).origin]);
  for (const entry of (process.env.APPLICATION_ALLOWED_ORIGINS ?? "").split(",")) {
    const origin = toOrigin(entry.trim());
    if (origin) origins.add(origin);
  }
  return origins;
}

function toOrigin(value: string): string | null {
  if (!value) return null;
  try {
    const { origin } = new URL(value);
    return origin === "null" ? null : origin;
  } catch {
    return null;
  }
}

function isAllowedOrigin(origin: string, allowed: ReadonlySet<string>, allowLocal: boolean) {
  if (allowed.has(origin)) return true;
  if (!allowLocal) return false;
  try {
    const url = new URL(origin);
    return (
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1") &&
      url.origin === origin
    );
  } catch {
    return false;
  }
}

function isJsonContentType(value: string | null) {
  return value?.split(";")[0].trim().toLowerCase() === "application/json";
}

const TOO_LARGE = Symbol("too large");

/** Reads at most MAX_BODY_BYTES as UTF-8. Null for undecodable bytes. */
async function readBody(request: Request): Promise<string | null | typeof TOO_LARGE> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return TOO_LARGE;
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return TOO_LARGE;
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** Accepts exactly {name: string, email: string}; anything else is a malformed request. */
function parseRequest(body: string): ApplicationRequest | null {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;

  const keys = Object.keys(data);
  if (keys.length !== 2 || !keys.includes("name") || !keys.includes("email")) return null;
  const { name, email } = data as Record<string, unknown>;
  if (typeof name !== "string" || typeof email !== "string") return null;
  return { name, email };
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

/** Error class and code only: messages and details can contain submitted values. */
function describeError(error: unknown) {
  if (!(error instanceof Error)) return { name: typeof error };
  const code = (error as { code?: unknown }).code;
  return { name: error.name, code: typeof code === "string" ? code : undefined };
}

function failure(
  status: number,
  code: ApplicationErrorCode,
  fieldErrors?: FieldErrors,
  headers?: Record<string, string>,
) {
  return respond(status, fieldErrors ? { ok: false, code, fieldErrors } : { ok: false, code }, headers);
}

function respond(status: number, body: ApplicationResult, headers?: Record<string, string>) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}
