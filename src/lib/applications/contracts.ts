// Client-safe contract for POST /api/applications. Shared by the form and the route handler;
// keep server-only imports (database, crypto, env) out of this file.

export const APPLICATIONS_ENDPOINT = "/api/applications";

export const NAME_MAX_LENGTH = 100;
export const EMAIL_MAX_LENGTH = 254;
export const MAX_BODY_BYTES = 8 * 1024;

export type ApplicationRequest = {
  name: string;
  email: string;
};

export type ApplicationField = keyof ApplicationRequest;

export type FieldError = "REQUIRED" | "TOO_LONG" | "INVALID";

export type FieldErrors = Partial<Record<ApplicationField, FieldError>>;

export type ApplicationErrorCode =
  | "INVALID_REQUEST"
  | "VALIDATION_ERROR"
  | "FORBIDDEN"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "RATE_LIMITED"
  | "UNAVAILABLE"
  | "INTERNAL_ERROR";

export type ApplicationResult =
  | { ok: true }
  | { ok: false; code: ApplicationErrorCode; fieldErrors?: FieldErrors };
