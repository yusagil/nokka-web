import "server-only";
import { getDatabase } from "@/lib/applications/db";
import { asObjectWithKeys, isJsonContentType, readJsonBody } from "@/lib/server/json-request";
import { installLinkUrl } from "@/lib/update-packages/install-contracts";
import { createInstallLinkStore, type InstallLinkStore } from "@/lib/update-packages/install-links";
import { newAccessToken, sha256 } from "@/lib/updates/registration/crypto";
import { getAuth } from "./better-auth";
import { createAdminApplicationsStore, type AdminApplicationsStore, type SearchCursor } from "./applications-store";
import {
  getConfiguredApprovalMailServices,
  runApprovalMail,
  sendApprovalMail,
  type ApprovalMailServices,
} from "./approval-mail";
import {
  ADMIN_PAGE_SIZE,
  ADMIN_PAGE_SIZE_MAX,
  ADMIN_REQUEST_HEADER,
  APPLICATION_STATUSES,
  INSTALL_LINK_TTL_HOURS,
  SEARCH_MAX_LENGTH,
  validateOperatorNote,
  type AdminErrorCode,
  type AdminFailure,
  type AdminFieldErrors,
  type AdminApplication,
  type ApplicationStatus,
  type ApprovalMailResult,
  type IssueInstallLinkResult,
  type RevokeInstallLinkResult,
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
  /** The approval mail's store, sender and link origin; null when the database is not configured. */
  getApprovalMail?: () => ApprovalMailServices | null;
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

/**
 * PATCH /api/admin/applications/:id. A save that turns updates on stores one approval mail with the change and
 * sends it after the commit, before answering: the answer's `approvalMail` says how it went. A failed or
 * uncertain mail never undoes the approval; the operator sends it again from the card.
 */
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
      const fields = asObjectWithKeys(body.value, ["status", "operatorNote", "updatesApproved", "expectedUpdatedAt"]);
      if (!fields) return failure(400, "INVALID_REQUEST");
      const { status, operatorNote, updatesApproved, expectedUpdatedAt } = fields;
      if (
        (status !== undefined && typeof status !== "string") ||
        (operatorNote !== undefined && typeof operatorNote !== "string") ||
        (updatesApproved !== undefined && typeof updatesApproved !== "boolean") ||
        typeof expectedUpdatedAt !== "string" ||
        (status === undefined && operatorNote === undefined && updatesApproved === undefined)
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
          updatesApproved,
          expectedUpdatedAt,
        });
      } catch (error) {
        return unavailable("update failed", error);
      }
      if (outcome.kind === "not_found") return failure(404, "NOT_FOUND");
      if (outcome.kind === "conflict") return failure(409, "CONFLICT");
      let item = outcome.item;
      if (outcome.approvalMailId) {
        // Without the services the mail stays stored; the recovery run or the operator sends it.
        const mail = deps.getApprovalMail();
        if (mail) {
          await sendApprovalMail(outcome.approvalMailId, mail);
          item = await reread(store, id, item);
        }
      }
      const result: UpdateResult = { ok: true, item };
      return respond(200, result);
    },
  );
}

/**
 * POST /api/admin/applications/:id/approval-mail with `{ expectedMailId, intent }` (see ApprovalMailRequest).
 * `send` sends a mail that never went out; `resend` follows a finished mail with a new one (and a new link that
 * closes the previous one). 409 `CONFLICT` when the card is out of date (the latest mail is another one, or in a
 * state its intent does not fit: a second press, another tab, a repeated request or the recovery run),
 * `MAIL_IN_PROGRESS` while one is being sent, `UPDATES_NOT_APPROVED` when updates are not allowed as saved.
 * Answers with the request as stored after the attempt.
 */
export function createApprovalMailHandler(options: AdminHandlerOptions = {}) {
  const deps = withDefaults(options);
  return withErrorBoundary(async (request: Request, context: { params: Promise<{ id: string }> }) => {
    const rejected = await guard(request, deps);
    if (rejected) return rejected;
    const { id } = await context.params;
    if (!isBigintId(id)) return failure(404, "NOT_FOUND");

    const body = await readJsonBody(request, MAX_BODY_BYTES);
    if (!body.ok) return body.reason === "TOO_LARGE" ? failure(413, "PAYLOAD_TOO_LARGE") : failure(400, "INVALID_REQUEST");
    const fields = asObjectWithKeys(body.value, ["expectedMailId", "intent"]);
    if (!fields || !("expectedMailId" in fields)) return failure(400, "INVALID_REQUEST");
    const { expectedMailId, intent } = fields;
    if (expectedMailId !== null && (typeof expectedMailId !== "string" || !isBigintId(expectedMailId))) {
      return failure(400, "INVALID_REQUEST");
    }
    if (intent !== "send" && intent !== "resend") return failure(400, "INVALID_REQUEST");

    const store = deps.getStore();
    const mail = deps.getApprovalMail();
    if (!store || !mail) return unavailable("database is not configured");
    let outcome;
    try {
      outcome = await mail.store.request(id, expectedMailId, intent);
    } catch (error) {
      return unavailable("approval mail request failed", error);
    }
    if (outcome.kind === "not_found") return failure(404, "NOT_FOUND");
    if (outcome.kind === "not_approved") return failure(409, "UPDATES_NOT_APPROVED");
    if (outcome.kind === "conflict") return failure(409, "CONFLICT");
    if (outcome.kind === "in_progress") return failure(409, "MAIL_IN_PROGRESS");

    await runApprovalMail(outcome.claim, mail);
    let item: AdminApplication | null;
    try {
      item = await store.get(id);
    } catch (error) {
      return unavailable("approval mail result lookup failed", error);
    }
    if (!item) return failure(404, "NOT_FOUND");
    const result: ApprovalMailResult = { ok: true, item };
    return respond(200, result);
  });
}

/** The request as stored now, or `fallback` when it can not be read (the save itself is committed). */
async function reread(store: AdminApplicationsStore, id: string, fallback: AdminApplication) {
  try {
    return (await store.get(id)) ?? fallback;
  } catch (error) {
    console.error(LOG_PREFIX, "saved request was not read again", describeError(error));
    return fallback;
  }
}

export type InstallLinkHandlerOptions = Pick<AdminHandlerOptions, "getAdminSession" | "getAllowedOrigin" | "getStore"> & {
  /** Null when the database is not configured; the API then answers 503. */
  getLinkStore?: () => InstallLinkStore | null;
  /** The link's secret: 32 random bytes, base64url. */
  newToken?: () => string;
};

/**
 * POST /api/admin/applications/:id/install-link (body `{}`): a new private install link for an allowed
 * request, replacing its open one. The URL (on this deployment's origin) is in this response only; its
 * secret is in the fragment, so opening it never sends the secret in a request line.
 * DELETE: revokes the open link.
 */
export function createInstallLinkHandlers(options: InstallLinkHandlerOptions = {}) {
  const deps = {
    ...withDefaults(options),
    getLinkStore:
      options.getLinkStore ??
      (() => {
        const sql = getDatabase();
        return sql ? createInstallLinkStore(sql) : null;
      }),
    newToken: options.newToken ?? newAccessToken,
    // The request is read back from the links' own database: the default one, or none when only a link store
    // is given (tests), so an answer never mixes two databases.
    getStore: options.getStore ?? (options.getLinkStore ? () => null : withDefaults(options).getStore),
  };
  type Context = { params: Promise<{ id: string }> };
  /** The request as stored now, for the card (a link made or revoked here cancels an unsent approval mail). */
  const current = async (id: string) => {
    const store = deps.getStore();
    if (!store) return {};
    try {
      const item = await store.get(id);
      return item ? { item } : {};
    } catch (error) {
      console.error(LOG_PREFIX, "request was not read after the link change", describeError(error));
      return {};
    }
  };

  const POST = withErrorBoundary(async (request: Request, context: Context) => {
    const rejected = await guard(request, deps);
    if (rejected) return rejected;
    const { id } = await context.params;
    if (!isBigintId(id)) return failure(404, "NOT_FOUND");

    const body = await readJsonBody(request, MAX_BODY_BYTES);
    if (!body.ok) return body.reason === "TOO_LARGE" ? failure(413, "PAYLOAD_TOO_LARGE") : failure(400, "INVALID_REQUEST");
    if (!asObjectWithKeys(body.value, [])) return failure(400, "INVALID_REQUEST");

    const store = deps.getLinkStore();
    const origin = deps.getAllowedOrigin();
    if (!store || !origin) return unavailable("database or origin is not configured");
    const token = deps.newToken();
    let outcome;
    try {
      outcome = await store.issue(id, { tokenHash: sha256(token), ttlSeconds: INSTALL_LINK_TTL_HOURS * 60 * 60 });
    } catch (error) {
      return unavailable("install link issue failed", error);
    }
    if (outcome.kind === "not_found") return failure(404, "NOT_FOUND");
    if (outcome.kind === "not_approved") return failure(409, "UPDATES_NOT_APPROVED");
    if (outcome.kind === "no_installer") return failure(409, "NO_INSTALLER");
    const result: IssueInstallLinkResult = {
      ok: true,
      link: { url: installLinkUrl(origin, token), ...outcome.link },
      ...(await current(id)),
    };
    return respond(201, result);
  });

  const DELETE = withErrorBoundary(async (request: Request, context: Context) => {
    const rejected = await guard(request, deps);
    if (rejected) return rejected;
    const { id } = await context.params;
    if (!isBigintId(id)) return failure(404, "NOT_FOUND");

    const store = deps.getLinkStore();
    if (!store) return unavailable("database is not configured");
    let outcome;
    try {
      outcome = await store.revoke(id);
    } catch (error) {
      return unavailable("install link revoke failed", error);
    }
    if (outcome.kind === "not_found") return failure(404, "NOT_FOUND");
    const result: RevokeInstallLinkResult = { ok: true, revoked: outcome.revoked, ...(await current(id)) };
    return respond(200, result);
  });

  return { POST, DELETE };
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
    getApprovalMail: options.getApprovalMail ?? getConfiguredApprovalMailServices,
  };
}

/** Session and admin id first, then the request must come from the admin page itself. */
async function guard(
  request: Request,
  deps: Pick<Deps, "getAdminSession" | "getAllowedOrigin">,
): Promise<Response | null> {
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

function respond(
  status: number,
  body: SearchResult | UpdateResult | ApprovalMailResult | IssueInstallLinkResult | RevokeInstallLinkResult | AdminFailure,
) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
