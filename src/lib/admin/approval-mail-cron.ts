import "server-only";
import { isAuthorized } from "@/lib/notifications/handler";
import {
  APPROVAL_MAIL_REQUEST_TIMEOUT_MS,
  getConfiguredApprovalMailServices,
  sendLeftBehindApprovalMails,
  type ApprovalMailServices,
} from "./approval-mail";

export type ApprovalMailRecoveryResponse =
  | { ok: true; attempted: number }
  | { ok: false; code: "UNAUTHENTICATED" | "UNAVAILABLE" | "INTERNAL_ERROR" };

export type ApprovalMailRecoveryOptions = {
  /** Null (or too short) when unset: every call is refused with 503. */
  getCronSecret?: () => string | null;
  /** Null when the database is not configured. */
  getServices?: () => ApprovalMailServices | null;
  /** Mails per call at most. */
  limit?: number;
  /** Time this call may spend on mails, from its start; keep it under the route's maxDuration. */
  budgetMs?: number;
  /** The longest one attempt takes (two bounded Gmail requests plus the database steps). */
  attemptMs?: number;
  /** The longest the send and its record take, checked again once an attempt holds its rows. */
  sendMs?: number;
  now?: () => number;
};

const LOG_PREFIX = "[approval-mail]";
const MIN_SECRET_LENGTH = 16;

/**
 * GET /api/cron/approval-mails, called once a day by Vercel Cron with `Authorization: Bearer <CRON_SECRET>`.
 * Sends approval mails that were stored but never handed to the mail service: the save's own attempt never
 * claimed them, or stopped before asking (the function ended, the database failed). A mail that may have been
 * sent (uncertain, or asked without a recorded answer) is never sent again here. Mails are claimed one at a
 * time, only while one more attempt fits in the time left; the rest stay for the next call (or the operator's
 * button). An attempt that waited for its rows until the send no longer fits hands its mail back unsent, so a
 * mail is never asked for so late that the function could end before its answer is recorded. Without mail
 * settings nothing is claimed (503), so the mails wait for the next call.
 */
export function createApprovalMailRecoveryHandler({
  getCronSecret = () => process.env.CRON_SECRET?.trim() || null,
  getServices = getConfiguredApprovalMailServices,
  limit = 20,
  // Inside the route's 60 seconds, with room for the response.
  budgetMs = 50_000,
  attemptMs = 2 * APPROVAL_MAIL_REQUEST_TIMEOUT_MS + 9_000,
  sendMs = APPROVAL_MAIL_REQUEST_TIMEOUT_MS + 2_000,
  now = Date.now,
}: ApprovalMailRecoveryOptions = {}) {
  async function handle(request: Request): Promise<Response> {
    const started = now();
    const secret = getCronSecret();
    if (!secret || secret.length < MIN_SECRET_LENGTH) {
      console.error(LOG_PREFIX, "CRON_SECRET is not configured");
      return respond(503, { ok: false, code: "UNAVAILABLE" });
    }
    if (!isAuthorized(request.headers.get("authorization"), secret)) {
      return respond(401, { ok: false, code: "UNAUTHENTICATED" });
    }
    const services = getServices();
    if (!services?.sender || !services.origin) {
      console.error(LOG_PREFIX, "mail, origin or database is not configured");
      return respond(503, { ok: false, code: "UNAVAILABLE" });
    }
    let attempted: number;
    try {
      attempted = await sendLeftBehindApprovalMails(services, { deadline: started + budgetMs, attemptMs, sendMs, limit, now });
    } catch (error) {
      console.error(LOG_PREFIX, "recovery failed", describeError(error));
      return respond(503, { ok: false, code: "UNAVAILABLE" });
    }
    return respond(200, { ok: true, attempted });
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

/** Error class and code only. */
function describeError(error: unknown) {
  if (!(error instanceof Error)) return { name: typeof error };
  const code = (error as { code?: unknown }).code;
  return { name: error.name, code: typeof code === "string" ? code : undefined };
}

function respond(status: number, body: ApprovalMailRecoveryResponse) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
