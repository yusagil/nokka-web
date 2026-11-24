// Client-safe contract for the private admin inbox (POST /api/admin/applications/search,
// PATCH /api/admin/applications/:id and POST/DELETE /api/admin/applications/:id/install-link). Shared
// by the admin UI and the route handlers; keep server-only imports (database, auth, env) out of this file.
import type { FieldError } from "@/lib/applications/contracts";

export type { FieldError };

/** PATCH `${ADMIN_APPLICATIONS_ENDPOINT}/${id}`. */
export const ADMIN_APPLICATIONS_ENDPOINT = "/api/admin/applications";
/** POST only: search terms stay out of URLs and access logs. */
export const ADMIN_SEARCH_ENDPOINT = "/api/admin/applications/search";
/** Every admin API request must send this header with value "1" (plus JSON content type). */
export const ADMIN_REQUEST_HEADER = "X-Admin-Request";
export const ADMIN_INBOX_PATH = "/admin/applications";
/** POST issues a new private install link for the request (replacing its open one); DELETE revokes it. */
export const installLinkEndpoint = (id: string) => `${ADMIN_APPLICATIONS_ENDPOINT}/${encodeURIComponent(id)}/install-link`;
/** POST (body `ApprovalMailRequest`) sends the approval mail now: a waiting one, or again with a new link. */
export const approvalMailEndpoint = (id: string) => `${ADMIN_APPLICATIONS_ENDPOINT}/${encodeURIComponent(id)}/approval-mail`;
export const ADMIN_LOGIN_PATH = "/admin/login";

export const ADMIN_PAGE_SIZE = 20;
export const ADMIN_PAGE_SIZE_MAX = 50;
export const SEARCH_MAX_LENGTH = 100;
export const NOTE_MAX_LENGTH = 500;
/** How long a private install link works after it is issued. */
export const INSTALL_LINK_TTL_HOURS = 72;

export const APPLICATION_STATUSES = ["new", "hold", "contacted"] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];
export type StatusFilter = "all" | ApplicationStatus;

/**
 * The approval mail's state, as the operator reads it:
 * - queued / sending: stored, or being handed to the mail service right now.
 * - accepted: the mail service took it (not proof that it reached the inbox).
 * - rejected: the mail service refused it; nothing was sent and its link is closed.
 * - uncertain: it may or may not have been sent (no answer, or the answer was lost). Never sent again
 *   automatically: sending it again may deliver a second mail.
 * - failed: stopped before the mail service was asked, nothing sent (`errorCode` says why).
 * - interrupted: stopped (or never picked up) before the mail service was asked, nothing sent.
 * - cancelled: the approval was withdrawn, or a link made by hand replaced it, before it was sent.
 */
export const APPROVAL_MAIL_STATUSES = [
  "queued",
  "sending",
  "accepted",
  "rejected",
  "uncertain",
  "failed",
  "interrupted",
  "cancelled",
] as const;
export type ApprovalMailStatus = (typeof APPROVAL_MAIL_STATUSES)[number];

/** The request's latest approval mail. Its link's address is never stored or returned, only its expiry. */
export type ApprovalMail = {
  id: string;
  /** approval: sent by saving the approval; manual: the operator asked for it. */
  trigger: "approval" | "manual";
  status: ApprovalMailStatus;
  /** Short machine code, for example no_installer, mail_not_configured or gmail_send_400_invalidArgument. */
  errorCode: string | null;
  createdAt: string;
  /** When the mail service was asked; null: it never was, so nothing was sent. */
  sendStartedAt: string | null;
  finishedAt: string | null;
  /** The expiry of the install link the mail carries; null when no link was made for it. */
  linkExpiresAt: string | null;
  /**
   * That link now: open (not downloaded yet), downloaded (its one download started, or any download of an older
   * link), expired, or closed (revoked or replaced). Null when no link was made for the mail.
   */
  linkState: "open" | "downloaded" | "expired" | "closed" | null;
};

/** The request's latest one-time code mail (requested from the app), as the mail service answered. */
export type CodeMail = {
  requestedAt: string;
  /** pending: the answer was not recorded (yet); uncertain: it may or may not have been sent. */
  status: "pending" | "accepted" | "rejected" | "uncertain";
};

/**
 * Timestamps are UTC ISO 8601 strings with milliseconds ("2026-11-19T00:12:34.567Z").
 * Send `updatedAt` back unchanged as `expectedUpdatedAt`.
 */
export type AdminApplication = {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  status: ApplicationStatus;
  /** Empty string when there is no note. */
  operatorNote: string;
  lastContactedAt: string | null;
  updatedAt: string;
  /**
   * The operator allowed this email to register a Mac for app updates. Off by default. Turning it on sends one
   * approval mail with a new install link; turning it off ends the registered Mac's updates, every unused code,
   * the open install link and an approval mail not yet sent, at once.
   */
  updatesApproved: boolean;
  /** A Mac is registered for updates now (only whether, never which). */
  macRegistered: boolean;
  /** Null when no code mail is kept (none was requested, or it was cleaned up after a day). */
  latestCodeMail: CodeMail | null;
  /** Null when none was ever stored (for example, allowed before approval mails existed). */
  approvalMail: ApprovalMail | null;
};

/**
 * Search body: q (trimmed, max 100, case-insensitive name/email substring), status (default all),
 * cursor (opaque nextCursor, reset when q/status change), limit 1-50 (default 20).
 */
export type SearchRequest = {
  q?: string;
  status?: StatusFilter;
  cursor?: string | null;
  limit?: number;
};

/** Newest first (createdAt DESC, id DESC). */
export type SearchResult = { ok: true; items: AdminApplication[]; nextCursor: string | null };

/** PATCH body: at least one of status / operatorNote / updatesApproved, plus the item's current updatedAt. */
export type ApplicationPatch = {
  status?: ApplicationStatus;
  operatorNote?: string;
  updatesApproved?: boolean;
  expectedUpdatedAt: string;
};

export type AdminErrorCode =
  | "INVALID_REQUEST"
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  /** Install link: the request's updates are not allowed (as saved). */
  | "UPDATES_NOT_APPROVED"
  /** Install link: no installer package is set up yet (or it was withdrawn). */
  | "NO_INSTALLER"
  /** Approval mail: one is being handed to the mail service right now. */
  | "MAIL_IN_PROGRESS"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "UNAVAILABLE"
  | "INTERNAL_ERROR";

export type AdminField = "q" | "status" | "cursor" | "limit" | "operatorNote" | "expectedUpdatedAt";
export type AdminFieldErrors = Partial<Record<AdminField, FieldError>>;

export type AdminFailure = { ok: false; code: AdminErrorCode; fieldErrors?: AdminFieldErrors };

export type UpdateResult = { ok: true; item: AdminApplication };

/**
 * A private install link for one allowed request. The URL is returned once, to the operator who issued
 * it, and stored only as a hash: hand it to that person privately. It serves Nokka `version` (`build`)
 * until `expiresAt`, unless it is revoked or replaced, the approval is withdrawn or the package is.
 */
export type InstallLink = { url: string; expiresAt: string; build: number; version: string };

/**
 * POST approval-mail, checked against what the card showed: `expectedMailId` is its `approvalMail.id` (null:
 * none) and `intent` what its button does. `send`: a mail that never went out (`queued`, `interrupted`, or none
 * yet) goes now. `resend`: after a finished mail (`accepted`, `rejected`, `uncertain`, `failed`, `cancelled`) a
 * new mail with a new link goes, and the previous link closes. A card that is out of date (another tab, the
 * recovery run, a repeated request) gets 409 `CONFLICT` and nothing is sent: reload it and decide again.
 */
export type ApprovalMailRequest = { expectedMailId: string | null; intent: ApprovalMailIntent };
export type ApprovalMailIntent = "send" | "resend";
/** Which request a card's button makes for the mail it shows. */
export const approvalMailIntent = (mail: ApprovalMail | null): ApprovalMailIntent | null => {
  if (!mail || mail.status === "queued" || mail.status === "interrupted") return "send";
  return mail.status === "sending" ? null : "resend";
};
/** 200, with the request as stored after the attempt (its `approvalMail` says how it went). */
export type ApprovalMailResult = { ok: true; item: AdminApplication };

/**
 * POST install-link (body `{}`): 201. `item`: the request as stored after it (a link made by hand cancels an
 * approval mail not yet sent), when it could be read; never the link's address.
 */
export type IssueInstallLinkResult = { ok: true; link: InstallLink; item?: AdminApplication };
/** DELETE install-link: `revoked` is 1 when an unexpired link was open, else 0. `item` as for POST. */
export type RevokeInstallLinkResult = { ok: true; revoked: number; item?: AdminApplication };

// Tab, newline and carriage return are fine in a note; other control characters are not.
const NOTE_CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;

/** Validates a note as the server will store it (trimmed). Null when valid. */
export function validateOperatorNote(note: string): FieldError | null {
  const trimmed = note.trim();
  if (trimmed.length > NOTE_MAX_LENGTH) return "TOO_LONG";
  if (NOTE_CONTROL_CHARACTERS.test(trimmed)) return "INVALID";
  return null;
}
