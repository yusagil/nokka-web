// Wire contract of the registered-updates API used by the Nokka app (no cookies, JSON over HTTPS).
// Keep server-only imports (database, crypto, env) out of this file.

export const UPDATES_API_PATH = "/api/updates/v1";
export const CHALLENGES_ENDPOINT = `${UPDATES_API_PATH}/challenges`;
export const REGISTRATIONS_ENDPOINT = `${UPDATES_API_PATH}/registrations`;
export const SESSIONS_ENDPOINT = `${UPDATES_API_PATH}/sessions`;

/** The production origin the app signs; other environments configure their own (UPDATES_SIGNING_ORIGIN). */
export const DEFAULT_SIGNING_ORIGIN = "https://nokka-web.vercel.app";

export const REGISTER_MESSAGE_TAG = "nokka-register-v1";
export const SESSION_MESSAGE_TAG = "nokka-session-v1";

export const CODE_LENGTH = 8;
export const CODE_TTL_SECONDS = 10 * 60;
/** A new code for the same installation and request is issued at most once per this many seconds. */
export const CODE_REISSUE_SECONDS = 60;
/** Wrong codes (with a valid signature) that end a challenge. */
export const CODE_MAX_FAILED_ATTEMPTS = 5;
export const SESSION_TTL_SECONDS = 15 * 60;
export const SESSION_CLOCK_SKEW_SECONDS = 120;

export const MAX_BODY_BYTES = 4 * 1024;

/** POST /challenges: `publicKey` is the 65-byte X9.63 uncompressed P-256 point, base64url. */
export type ChallengeRequest = { email: string; installationId: string; publicKey: string };
/** 202 for every well-formed request, whether or not a code was sent. */
export type ChallengeResponse = { ok: true; challengeId: string; expiresAt: string };

/** POST /registrations: `code` keeps leading zeros; `signature` is r||s (64 bytes) base64url. */
export type RegistrationRequest = {
  challengeId: string;
  installationId: string;
  code: string;
  signature: string;
};
export type RegistrationResponse = { ok: true; installationId: string };

/** POST /sessions: `issuedAt` is Unix epoch seconds; `nonce` is 32 random bytes base64url. */
export type SessionRequest = {
  installationId: string;
  issuedAt: number;
  nonce: string;
  signature: string;
};
export type SessionResponse = { ok: true; accessToken: string; expiresAt: string };

export type UpdatesErrorCode =
  | "INVALID_REQUEST"
  | "RATE_LIMITED"
  | "UNAVAILABLE"
  | "INVALID_CHALLENGE"
  | "INVALID_PROOF"
  | "REGISTRATION_INACTIVE"
  | "INVALID_TOKEN"
  | "INTERNAL_ERROR";

export type UpdatesFailure = { ok: false; code: UpdatesErrorCode };
