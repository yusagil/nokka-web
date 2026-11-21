// Client-safe contract for the private admin inbox (POST /api/admin/applications/search and
// PATCH /api/admin/applications/:id). Shared by the admin UI and the route handlers; keep server-only
// imports (database, auth, env) out of this file.
import type { FieldError } from "@/lib/applications/contracts";

export type { FieldError };

/** PATCH `${ADMIN_APPLICATIONS_ENDPOINT}/${id}`. */
export const ADMIN_APPLICATIONS_ENDPOINT = "/api/admin/applications";
/** POST only: search terms stay out of URLs and access logs. */
export const ADMIN_SEARCH_ENDPOINT = "/api/admin/applications/search";
/** Every admin API request must send this header with value "1" (plus JSON content type). */
export const ADMIN_REQUEST_HEADER = "X-Admin-Request";
export const ADMIN_INBOX_PATH = "/admin/applications";
export const ADMIN_LOGIN_PATH = "/admin/login";

export const ADMIN_PAGE_SIZE = 20;
export const ADMIN_PAGE_SIZE_MAX = 50;
export const SEARCH_MAX_LENGTH = 100;
export const NOTE_MAX_LENGTH = 500;

export const APPLICATION_STATUSES = ["new", "hold", "contacted"] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];
export type StatusFilter = "all" | ApplicationStatus;

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
   * The operator allowed this email to register a Mac for app updates. Off by default; turning it on
   * sends nothing, turning it off ends the registered Mac's updates and every unused code at once.
   */
  updatesApproved: boolean;
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
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "UNAVAILABLE"
  | "INTERNAL_ERROR";

export type AdminField = "q" | "status" | "cursor" | "limit" | "operatorNote" | "expectedUpdatedAt";
export type AdminFieldErrors = Partial<Record<AdminField, FieldError>>;

export type AdminFailure = { ok: false; code: AdminErrorCode; fieldErrors?: AdminFieldErrors };

export type UpdateResult = { ok: true; item: AdminApplication };

// Tab, newline and carriage return are fine in a note; other control characters are not.
const NOTE_CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;

/** Validates a note as the server will store it (trimmed). Null when valid. */
export function validateOperatorNote(note: string): FieldError | null {
  const trimmed = note.trim();
  if (trimmed.length > NOTE_MAX_LENGTH) return "TOO_LONG";
  if (NOTE_CONTROL_CHARACTERS.test(trimmed)) return "INVALID";
  return null;
}
