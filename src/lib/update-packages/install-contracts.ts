// Client-safe contract of the private install link flow: the /install page and its two endpoints. The
// link's secret is in the URL fragment, which browsers never send. The page moves it into a JSON body
// once, and the server answers with an HttpOnly cookie that the download sends. So the secret is never
// in a request path, query string or referrer, the parts of a request that hosting logs record.
// A link opens once: the first successful session consumes its secret, and the cookie carries a session
// secret of its own, so the link's secret opens nothing after that.
// Keep server-only imports (database, crypto, env) out of this file.

/** The page a link opens: `${origin}/install#<token>`. */
export const INSTALL_PAGE_PATH = "/install";
/** POST `{ token }`: opens the link (once) and sets that link's download cookie. */
export const INSTALL_SESSION_ENDPOINT = "/api/updates/v1/install/session";

/** 32 random bytes, unpadded base64url. */
export const INSTALL_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
/** A link's `ref`: a random lower-case UUID v4 that is not secret (it opens nothing without the token). */
export const INSTALL_REF_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// Each link has its own download address and its own cookie, sent only to that address: a page shows one
// link, and its download and resume serve exactly that link, whatever other tabs opened since.
/** GET/HEAD (whole or one byte range) with the link's cookie, or its value as `Authorization: Bearer`. */
export const installDownloadPath = (ref: string) => `/api/updates/v1/install/${ref}/Nokka.dmg`;
export const installCookiePath = (ref: string) => `/api/updates/v1/install/${ref}`;
export const installCookieName = (ref: string) => `__Secure-nokka-install-${ref}`;

export const installLinkUrl = (origin: string, token: string) => `${origin}${INSTALL_PAGE_PATH}#${token}`;

export type InstallSessionRequest = { token: string };

/** 200: the link was open and is now opened; its cookie is set for the link's remaining lifetime. */
export type InstallSessionResult = {
  ok: true;
  /** Download from `installDownloadPath(ref)`. */
  ref: string;
  version: string;
  build: number;
  byteLength: number;
  expiresAt: string;
};

export type InstallErrorCode =
  /** Malformed or unknown token. */
  | "NOT_FOUND"
  /** Expired, revoked, replaced, approval withdrawn or package withdrawn. */
  | "GONE"
  /** 410 as well: still open, but already opened once (by this or another browser); see InstallUsedFailure. */
  | "USED"
  | "INVALID_REQUEST"
  | "FORBIDDEN"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "PAYLOAD_TOO_LARGE"
  | "UNAVAILABLE"
  | "INTERNAL_ERROR";

export type InstallFailure = { ok: false; code: InstallErrorCode };

/**
 * 410 `USED` names the link and what it serves, as the first 200 did: nothing secret, and nothing it opens.
 * The browser that opened the link holds its session cookie, so a page that lost the first answer (or was
 * refused because another tab of this browser opened the link first) checks `HEAD installDownloadPath(ref)`
 * with this browser's cookies: 200 means this browser can download and resume it; 404 means it holds no
 * session for this link (another browser opened it, or the cookie was lost too) and a new link is needed;
 * 410 means the link has closed since. A closed link answers a plain `GONE` without any of this.
 */
export type InstallUsedFailure = Omit<InstallSessionResult, "ok"> & { ok: false; code: "USED" };
