import "server-only";
import { getDatabase } from "@/lib/applications/db";
import { asObjectWithKeys, isJsonContentType, readJsonBody } from "@/lib/server/json-request";
import { getAuth } from "./better-auth";
import { createAdminApplicationsStore, type AdminApplicationsStore, type SearchCursor } from "./applications-store";
import {
  ADMIN_PAGE_SIZE,
  ADMIN_PAGE_SIZE_MAX,
  ADMIN_REQUEST_HEADER,
  APPLICATION_STATUSES,
  SEARCH_MAX_LENGTH,
  validateOperatorNote,
  type AdminErrorCode,
  type AdminFailure,
  type AdminFieldErrors,
  type ApplicationStatus,
  type SearchResult,
  type StatusFilter,
  type UpdateResult,
} from "./contracts";
import { getAdminSession as readAdminSession, type AdminSessionResult } from "./session";

export type AdminHandlerOptions = {
  getAdminSession?: (requestHeaders: Headers) => Promise<AdminSessionResult>;
  /** Null when the database is not configured; the API then answers 503. */
  getStore?: () => AdminApplicationsStore | null;
  /** The one origin allowed to call the admin API (BETTER_AUTH_URL), or null when unconfigured. */
  getAllowedOrigin?: () => string | null;
};

const MAX_BODY_BYTES = 8 * 1024;
const LOG_PREFIX = "[admin]";
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;
const ISO_MILLISECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ISO_MICROSECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const MAX_BIGINT = BigInt("9223372036854775807");

/** POST /api/admin/applications/search */
export function createSearchHandler(options: AdminHandlerOptions = {}) {
  const deps = withDefaults(options);
  return withErrorBoundary(async (request: Request) => {
    const rejected = await guard(request, deps);
    if (rejected) return rejected;

    const body = await readJsonBody(request, MAX_BODY_BYTES);
    if (!body.ok) return body.reason === "TOO_LARGE" ? failure(413, "PAYLOAD_TOO_LARGE") : failure(400, "INVALID_REQUEST");
    const fields = asObjectWithKeys(body.value, ["q", "status", "cursor", "limit"]);
    if (!fields) return failure(400, "INVALID_REQUEST");
    const { q = "", status = "all", cursor = null, limit = ADMIN_PAGE_SIZE } = fields;
    if (
      typeof q !== "string" ||
      typeof status !== "string" ||
      (cursor !== null && typeof cursor !== "string") ||
      typeof limit !== "number"
    ) {
      return failure(400, "INVALID_REQUEST");
    }

    const query = q.trim();
    const fieldErrors: AdminFieldErrors = {};
    if (query.length > SEARCH_MAX_LENGTH) fieldErrors.q = "TOO_LONG";
    else if (CONTROL_CHARACTERS.test(query)) fieldErrors.q = "INVALID";
    if (status !== "all" && !isStatus(status)) fieldErrors.status = "INVALID";
    if (!Number.isInteger(limit) || limit < 1 || limit > ADMIN_PAGE_SIZE_MAX) fieldErrors.limit = "INVALID";
    const position = cursor === null ? null : decodeCursor(cursor);
    if (cursor !== null && !position) fieldErrors.cursor = "INVALID";
    if (Object.keys(fieldErrors).length > 0) return failure(400, "VALIDATION_ERROR", fieldErrors);

    const store = deps.getStore();
    if (!store) return unavailable("database is not configured");
    let page;
    try {
      page = await store.search({ q: query, status: status as StatusFilter, cursor: position, limit });
    } catch (error) {
      return unavailable("search failed", error);
    }
    const result: SearchResult = {
      ok: true,
      items: page.items,
      nextCursor: page.nextCursor ? encodeCursor(page.nextCursor) : null,
    };
    return respond(200, result);
  });
}

/** PATCH /api/admin/applications/:id */
export function createUpdateHandler(options: AdminHandlerOptions = {}) {
  const deps = withDefaults(options);
  return withErrorBoundary(
    async (request: Request, context: { params: Promise<{ id: string }> }) => {
      const rejected = await guard(request, deps);
      if (rejected) return rejected;

      const { id } = await context.params;
      if (!isBigintId(id)) return failure(404, "NOT_FOUND");

      const body = await readJsonBody(request, MAX_BODY_BYTES);
      if (!body.ok) return body.reason === "TOO_LARGE" ? failure(413, "PAYLOAD_TOO_LARGE") : failure(400, "INVALID_REQUEST");
      const fields = asObjectWithKeys(body.value, ["status", "operatorNote", "expectedUpdatedAt"]);
      if (!fields) return failure(400, "INVALID_REQUEST");
      const { status, operatorNote, expectedUpdatedAt } = fields;
      if (
        (status !== undefined && typeof status !== "string") ||
        (operatorNote !== undefined && typeof operatorNote !== "string") ||
        typeof expectedUpdatedAt !== "string" ||
        (status === undefined && operatorNote === undefined)
      ) {
        return failure(400, "INVALID_REQUEST");
      }

      const fieldErrors: AdminFieldErrors = {};
      if (status !== undefined && !isStatus(status)) fieldErrors.status = "INVALID";
      const noteError = operatorNote === undefined ? null : validateOperatorNote(operatorNote);
      if (noteError) fieldErrors.operatorNote = noteError;
      if (!isTimestamp(expectedUpdatedAt, ISO_MILLISECONDS)) fieldErrors.expectedUpdatedAt = "INVALID";
      if (Object.keys(fieldErrors).length > 0) return failure(400, "VALIDATION_ERROR", fieldErrors);

      const store = deps.getStore();
      if (!store) return unavailable("database is not configured");
      let outcome;
      try {
        outcome = await store.update(id, {
          status: status as ApplicationStatus | undefined,
          operatorNote: operatorNote?.trim(),
          expectedUpdatedAt,
        });
      } catch (error) {
        return unavailable("update failed", error);
      }
      if (outcome.kind === "not_found") return failure(404, "NOT_FOUND");
      if (outcome.kind === "conflict") return failure(409, "CONFLICT");
      const result: UpdateResult = { ok: true, item: outcome.item };
      return respond(200, result);
    },
  );
}

type Deps = Required<AdminHandlerOptions>;

function withDefaults(options: AdminHandlerOptions): Deps {
  return {
    getAdminSession: options.getAdminSession ?? readAdminSession,
    getStore:
      options.getStore ??
      (() => {
        const sql = getDatabase();
        return sql ? createAdminApplicationsStore(sql) : null;
      }),
    getAllowedOrigin: options.getAllowedOrigin ?? (() => getAuth()?.config.baseURL ?? null),
  };
}

/** Session and admin id first, then the request must come from the admin page itself. */
async function guard(request: Request, deps: Deps): Promise<Response | null> {
  const session = await deps.getAdminSession(request.headers);
  if (!session.ok) return failure(session.status, session.code);

  const allowedOrigin = deps.getAllowedOrigin();
  if (
    !allowedOrigin ||
    request.headers.get("origin") !== allowedOrigin ||
    request.headers.get(ADMIN_REQUEST_HEADER) !== "1"
  ) {
    return failure(403, "FORBIDDEN");
  }
  if (!isJsonContentType(request.headers.get("content-type"))) {
    return failure(415, "UNSUPPORTED_MEDIA_TYPE");
  }
  return null;
}

function withErrorBoundary<Args extends unknown[]>(handle: (...args: Args) => Promise<Response>) {
  return async (...args: Args): Promise<Response> => {
    try {
      return await handle(...args);
    } catch (error) {
      console.error(LOG_PREFIX, "unexpected error", describeError(error));
      return failure(500, "INTERNAL_ERROR");
    }
  };
}

function isStatus(value: string): value is ApplicationStatus {
  return (APPLICATION_STATUSES as readonly string[]).includes(value);
}

function isBigintId(value: string) {
  return /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= MAX_BIGINT;
}

function isTimestamp(value: string, format: RegExp) {
  return format.test(value) && !Number.isNaN(Date.parse(value.slice(0, 23) + "Z"));
}

/** Opaque to clients: base64url of [createdAt with microseconds, id]. No names, emails or terms. */
function encodeCursor({ createdAt, id }: SearchCursor): string {
  return Buffer.from(JSON.stringify([createdAt, id])).toString("base64url");
}

function decodeCursor(value: string): SearchCursor | null {
  if (value.length > 200) return null;
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!Array.isArray(decoded) || decoded.length !== 2) return null;
    const [createdAt, id] = decoded;
    if (typeof createdAt !== "string" || typeof id !== "string") return null;
    if (!isTimestamp(createdAt, ISO_MICROSECONDS) || !isBigintId(id)) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

function unavailable(reason: string, error?: unknown) {
  console.error(LOG_PREFIX, reason, error === undefined ? "" : describeError(error));
  return failure(503, "UNAVAILABLE");
}

/** Error class and code only: messages can contain names, emails, notes or search terms. */
function describeError(error: unknown) {
  if (!(error instanceof Error)) return { name: typeof error };
  const code = (error as { code?: unknown }).code;
  return { name: error.name, code: typeof code === "string" ? code : undefined };
}

function failure(status: number, code: AdminErrorCode, fieldErrors?: AdminFieldErrors) {
  const body: AdminFailure = fieldErrors ? { ok: false, code, fieldErrors } : { ok: false, code };
  return respond(status, body);
}

function respond(status: number, body: SearchResult | UpdateResult | AdminFailure) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
