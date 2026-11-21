// Client-safe validation shared by the form and the route handler.
import {
  EMAIL_MAX_LENGTH,
  NAME_MAX_LENGTH,
  type ApplicationRequest,
  type FieldError,
  type FieldErrors,
} from "./contracts";

// C0/C1 control characters (includes newlines and tabs) plus Unicode line/paragraph separators.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

// Non-empty local part, a single "@", and a dot-separated domain with no empty labels.
const EMAIL_FORMAT = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

export type ValidationResult =
  | { ok: true; value: ApplicationRequest }
  | { ok: false; fieldErrors: FieldErrors };

/** Trims both fields and checks them against the contract. Lengths use JS string length. */
export function validateApplication(input: ApplicationRequest): ValidationResult {
  const name = input.name.trim();
  const email = input.email.trim();
  const fieldErrors: FieldErrors = {};

  if (name.length === 0) fieldErrors.name = "REQUIRED";
  else if (name.length > NAME_MAX_LENGTH) fieldErrors.name = "TOO_LONG";
  else if (CONTROL_CHARACTERS.test(name)) fieldErrors.name = "INVALID";

  const emailError = validateEmail(email);
  if (emailError) fieldErrors.email = emailError;

  if (fieldErrors.name || fieldErrors.email) return { ok: false, fieldErrors };
  return { ok: true, value: { name, email } };
}

/** Checks an already trimmed email against the contract; null when valid. */
export function validateEmail(email: string): FieldError | null {
  if (email.length === 0) return "REQUIRED";
  if (email.length > EMAIL_MAX_LENGTH) return "TOO_LONG";
  if (CONTROL_CHARACTERS.test(email) || !EMAIL_FORMAT.test(email)) return "INVALID";
  return null;
}
