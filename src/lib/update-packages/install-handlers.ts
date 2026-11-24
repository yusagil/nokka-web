import "server-only";
import { getDatabase } from "@/lib/applications/db";
import { asObjectWithKeys, isJsonContentType, readJsonBody } from "@/lib/server/json-request";
import { readBearerToken } from "@/lib/updates/registration/authorize";
import { decodeBase64url, newAccessToken, sha256, TOKEN_BYTES } from "@/lib/updates/registration/crypto";
import { CLIENT_GONE_STATUS, defaultPackageStore, respondWithPackage, type Method, type PackageErrorCode } from "./handlers";
import {
  INSTALL_BUTTON_ACTION,
  INSTALL_REF_PATTERN,
  installCookieName,
  installCookiePath,
  type InstallErrorCode,
  type InstallFailure,
  type InstallSessionResult,
  type InstallUsedFailure,
} from "./install-contracts";
import { createInstallLinkStore, type ExchangeOutcome, type InstallLinkStore, type ResolvedInstallLink } from "./install-links";
import type { PackageStore } from "./store";

// The private install link flow (contract: ./install-contracts.ts). The link's secret reaches this server
// only in the session's JSON body, which consumes it; the download takes the session secret that the
// session hands back, in an HttpOnly cookie or an Authorization header. Neither is ever in a path or query
// string, so request logs (path, query, user agent, referrer) do not record them. Logs here carry error
// class and code only.

export type InstallHandlerOptions = {
  /** Null when the database is not configured (503). */
  getLinkStore?: () => InstallLinkStore | null;
  getStore?: () => PackageStore | null;
  /** A link's one session secret: 32 random bytes, base64url. */
  newSessionSecret?: () => string;
};

const LOG_PREFIX = "[install-links]";
const MAX_BODY_BYTES = 1024;

// Opened from a browser: answers stay out of caches, referrers and search indexes.
const LINK_HEADERS = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
  "X-Content-Type-Options": "nosniff",
} as const;

// One cookie per link, holding its session secret (never the link's own), sent back by the browser only
// to that link's download address, never readable by scripts and never sent from another site. Links
// opened in other tabs keep their own.
const cookieAttributes = (ref: string) => `Path=${installCookiePath(ref)}; HttpOnly; Secure; SameSite=Strict`;
const setCookie = (ref: string, secret: string, maxAge: number) =>
  `${installCookieName(ref)}=${secret}; Max-Age=${maxAge}; ${cookieAttributes(ref)}`;
const clearCookie = (ref: string) => `${installCookieName(ref)}=; Max-Age=0; ${cookieAttributes(ref)}`;

// A link opens once, so a browser without its session can not get one by opening the link again.
const NO_SESSION_MESSAGE =
  "이 브라우저에서는 이 주소로 받을 수 없습니다. 설치 링크는 한 번만 쓸 수 있어, 설치 페이지에서 ‘설치 파일 받기’를 처음 누른 브라우저에서만 받을 수 있습니다. 그 브라우저가 없거나 이미 쓴 링크라면 새 링크가 필요합니다.\n" +
  "This browser can't download from this address. An install link works only once: only the browser where ‘설치 파일 받기’ (Download) was first pressed on the install page can download. If that browser is gone or the link was already used, you need a new one.";
const CLOSED_MESSAGE =
  "이 설치 링크로는 받을 수 없습니다. 유효 기간이 지났거나 회수된 링크입니다. 새 링크가 필요합니다.\n" +
  "This install link can't be used: it has expired or was revoked. You need a new one.";
// A link issued since 0009 sends its package once: the browser's own resume or a second download is refused.
const TRANSFERRED_MESSAGE =
  "이 설치 링크로는 이미 설치 파일을 받기 시작했습니다. 링크로는 한 번만 받을 수 있습니다. 받은 파일이 없거나 받는 중에 끊겼다면 새 링크가 필요하니, 안내 메일에 회신해 주세요.\n" +
  "The installer was already downloaded with this install link, which downloads only once. If you don't have the file or the download stopped, you need a new link: reply to the email you got it from.";
const DOWNLOAD_MESSAGES: Partial<Record<DownloadErrorCode, string>> = {
  NOT_FOUND: NO_SESSION_MESSAGE,
  GONE: CLOSED_MESSAGE,
  USED: TRANSFERRED_MESSAGE,
  RANGE_NOT_SATISFIABLE: "요청한 범위가 파일 크기를 벗어났습니다.\nThe requested range is outside the file.",
};
const UNAVAILABLE_MESSAGE =
  "지금은 설치 파일을 받을 수 없습니다. 잠시 후 다시 시도해 주세요.\n" +
  "The installer can't be downloaded right now. Please try again later.";

// respondWithPackage itself only refuses with RANGE_NOT_SATISFIABLE.
type DownloadErrorCode = InstallErrorCode | PackageErrorCode;

/**
 * POST /api/updates/v1/install/session with `{ "token": "<from the link's fragment>", "action": "download" }`,
 * sent by the page's button. The first call for an open link consumes its token and gets 200 with its `ref`
 * and what it serves, and an HttpOnly cookie with a new session secret for that link's download address, for
 * its remaining lifetime. Every later call with that token gets 410 `USED`, at the same time or after, with the
 * same `ref` and what it serves but no cookie, so a browser that already holds the session can find its
 * download again (see InstallUsedFailure); malformed or unknown tokens get 404, closed links 410 `GONE`. A link
 * issued since 0009 opened without `action` (a page from before it, which opens links as it loads) gets 409
 * `BUTTON_REQUIRED` and stays unused. A refusal or failure (503) leaves the token unused, so it can be retried.
 * Only the /install page of this site may call it.
 */
export function createInstallSessionHandler(options: InstallHandlerOptions = {}) {
  const deps = withDefaults(options);
  return async (request: Request): Promise<Response> => {
    try {
      // A page on another site can not send JSON here (that needs a preflight this route never allows),
      // and browsers mark where their own requests come from.
      const site = request.headers.get("sec-fetch-site");
      if (site !== null && site !== "same-origin") return sessionFailure(403, "FORBIDDEN");
      if (!isJsonContentType(request.headers.get("content-type"))) {
        return sessionFailure(415, "UNSUPPORTED_MEDIA_TYPE");
      }
      const body = await readJsonBody(request, MAX_BODY_BYTES);
      if (!body.ok) {
        return body.reason === "TOO_LARGE" ? sessionFailure(413, "PAYLOAD_TOO_LARGE") : sessionFailure(400, "INVALID_REQUEST");
      }
      const fields = asObjectWithKeys(body.value, ["token", "action"]);
      if (!fields || typeof fields.token !== "string") return sessionFailure(400, "INVALID_REQUEST");
      if (fields.action !== undefined && fields.action !== INSTALL_BUTTON_ACTION) return sessionFailure(400, "INVALID_REQUEST");
      const token = fields.token;
      // Malformed tokens never reach the database.
      if (!decodeBase64url(token, TOKEN_BYTES)) return sessionFailure(404, "NOT_FOUND");

      const links = deps.getLinkStore();
      if (!links) return sessionUnavailable("database is not configured");
      const secret = deps.newSessionSecret();
      let outcome: ExchangeOutcome;
      try {
        outcome = await links.exchange(sha256(token), sha256(secret), { button: fields.action === INSTALL_BUTTON_ACTION });
      } catch (error) {
        return sessionUnavailable("link exchange failed", error);
      }
      if (outcome.kind === "not_found") return sessionFailure(404, "NOT_FOUND");
      if (outcome.kind === "gone") return sessionFailure(410, "GONE");
      if (outcome.kind === "button_required") return sessionFailure(409, "BUTTON_REQUIRED");
      // No new session and no cookie: only a browser that already holds this link's session can use it.
      if (outcome.kind === "used") return json(410, { ok: false, code: "USED", ...describeLink(outcome.link) });

      const { link, maxAge } = outcome;
      return json(200, { ok: true, ...describeLink(link) }, { "Set-Cookie": setCookie(link.ref, secret, maxAge) });
    } catch (error) {
      console.error(LOG_PREFIX, "unexpected error", describeError(error));
      return sessionFailure(500, "INTERNAL_ERROR");
    }
  };
}

type RefParams = { params: Promise<{ ref: string }> };

/**
 * GET and HEAD /api/updates/v1/install/{ref}/Nokka.dmg: the package the link `ref` was issued for, as an
 * attachment. The session secret comes from that link's cookie, or from `Authorization: Bearer` for tools, and
 * must be the session of the link `ref`: a page's download serves exactly the link it shows. The link's own
 * token is not a session and opens nothing here. Every request is checked: once the link expires or is revoked
 * or replaced, its approval withdrawn or its package withdrawn, new requests get 410. A response already
 * sending bytes is not cut off.
 *
 * A link issued since 0009 sends its package once, whole: its answers advertise no ranges, a satisfiable range
 * gets the whole file (200), and the one transfer is taken right before the first byte, once the first chunk
 * is ready. A transfer taken before (also by a concurrent request), a link closed meanwhile or a failure to
 * record it refuses the request and sends no byte of the package. HEAD, 304, ranges not satisfiable as sent
 * (416, whatever `If-Range` says) and a request whose client went away first (499) take nothing. After that
 * every request gets 410 `USED`. Links issued before keep downloading and resuming (206) until they close.
 */
export function createInstallDownloadHandlers(options: InstallHandlerOptions = {}) {
  const deps = withDefaults(options);
  const handle = (method: Method) => async (request: Request, context: RefParams): Promise<Response> => {
    try {
      const ref = (await context.params).ref;
      // Never a secret: anything but a ref is refused before cookies or the database are read.
      if (!INSTALL_REF_PATTERN.test(ref)) return downloadFailure(method, 404, "NOT_FOUND");
      const bearer = readBearerToken(request.headers);
      const cookie = bearer === null ? readCookie(request.headers.get("cookie"), installCookieName(ref)) : null;
      const secret = bearer ?? cookie;
      // A cookie that opens nothing any more is removed, as are cookies set before links opened once
      // (they carried the link's token).
      const refuse = (status: number, code: DownloadErrorCode) =>
        downloadFailure(method, status, code, cookie !== null ? { "Set-Cookie": clearCookie(ref) } : {});
      if (secret === null || !decodeBase64url(secret, TOKEN_BYTES)) return refuse(404, "NOT_FOUND");

      const links = deps.getLinkStore();
      const store = deps.getStore();
      if (!links || !store) return downloadUnavailable(method, "database is not configured");
      let link: ResolvedInstallLink | null;
      try {
        link = await links.resolveSession(sha256(secret));
      } catch (error) {
        return downloadUnavailable(method, "link lookup failed", error);
      }
      // Another link's session does not open this address.
      if (!link || link.ref !== ref) return refuse(404, "NOT_FOUND");
      if (!link.live) return refuse(410, "GONE");
      if (link.singleTransfer && link.transferStarted) return refuse(410, "USED");

      const resolved = link;
      const headers = {
        ...LINK_HEADERS,
        "Content-Disposition": `attachment; filename="Nokka-${resolved.version}.dmg"`,
      };
      const refuseRange = (status: number, code: PackageErrorCode, extra: Record<string, string>) =>
        downloadFailure(method, status, code, extra);
      const unavailableNow = (reason: string, error?: unknown) => downloadUnavailable(method, reason, error);
      if (resolved.singleTransfer) {
        return respondWithPackage(request, method, store, resolved.info, {
          headers,
          refuse: refuseRange,
          unavailable: unavailableNow,
          wholeOnly: true,
          // Throws on a database error: then nothing is sent either (503), and the transfer stays untaken.
          async beforeStream() {
            const taken = await links.startTransfer(resolved.id, { signal: request.signal });
            if (taken.kind === "started") return null;
            if (taken.kind === "cancelled") return new Response(null, { status: CLIENT_GONE_STATUS, headers: LINK_HEADERS });
            return refuse(410, taken.kind === "used" ? "USED" : "GONE");
          },
        });
      }
      return respondWithPackage(request, method, store, resolved.info, {
        headers,
        refuse: refuseRange,
        unavailable: unavailableNow,
        async onStream() {
          try {
            await links.recordDownload(resolved.id);
          } catch (error) {
            // The download itself is valid; only the operator's count misses it.
            console.error(LOG_PREFIX, "download was not counted", describeError(error));
          }
        },
      });
    } catch (error) {
      console.error(LOG_PREFIX, "unexpected error", describeError(error));
      return downloadFailure(method, 500, "INTERNAL_ERROR");
    }
  };
  return { GET: handle("GET"), HEAD: handle("HEAD") };
}

/** The value of the first cookie named `name` (the most specific path comes first), else null. */
export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator > 0 && part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return null;
}

function withDefaults(options: InstallHandlerOptions): Required<InstallHandlerOptions> {
  return {
    getLinkStore:
      options.getLinkStore ??
      (() => {
        const sql = getDatabase();
        return sql ? createInstallLinkStore(sql) : null;
      }),
    getStore: options.getStore ?? defaultPackageStore,
    newSessionSecret: options.newSessionSecret ?? newAccessToken,
  };
}

/** What the page shows for a link: its download address and what it serves, nothing secret. */
function describeLink(link: ResolvedInstallLink): Omit<InstallSessionResult, "ok"> {
  return {
    ref: link.ref,
    version: link.version,
    build: link.info.build,
    byteLength: link.info.byteLength,
    expiresAt: link.expiresAt,
    singleTransfer: link.singleTransfer,
  };
}

function json(
  status: number,
  body: InstallSessionResult | InstallUsedFailure | InstallFailure,
  extra: Record<string, string> = {},
) {
  return Response.json(body, { status, headers: { ...LINK_HEADERS, ...extra } });
}

function sessionFailure(status: number, code: InstallErrorCode) {
  return json(status, { ok: false, code });
}

function sessionUnavailable(reason: string, error?: unknown) {
  console.error(LOG_PREFIX, reason, error === undefined ? "" : describeError(error));
  return sessionFailure(503, "UNAVAILABLE");
}

function downloadUnavailable(method: Method, reason: string, error?: unknown) {
  console.error(LOG_PREFIX, reason, error === undefined ? "" : describeError(error));
  return downloadFailure(method, 503, "UNAVAILABLE");
}

/** Short plain text for a person in a browser: no package bytes, validators or Location. */
function downloadFailure(method: Method, status: number, code: DownloadErrorCode, extra: Record<string, string> = {}) {
  const body = new TextEncoder().encode(`${DOWNLOAD_MESSAGES[code] ?? UNAVAILABLE_MESSAGE}\n`);
  const headers = {
    ...LINK_HEADERS,
    ...extra,
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": String(body.byteLength),
  };
  return new Response(method === "HEAD" ? null : body, { status, headers });
}

/** Error class and code only: messages can contain request data. */
function describeError(error: unknown) {
  if (!(error instanceof Error)) return { name: typeof error };
  const code = (error as { code?: unknown }).code;
  return { name: error.name, code: typeof code === "string" ? code : undefined };
}
