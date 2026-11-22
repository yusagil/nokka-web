import "server-only";
import { getDatabase } from "@/lib/applications/db";
import { asObjectWithKeys, isJsonContentType, readJsonBody } from "@/lib/server/json-request";
import { readBearerToken } from "@/lib/updates/registration/authorize";
import { decodeBase64url, sha256, TOKEN_BYTES } from "@/lib/updates/registration/crypto";
import { defaultPackageStore, respondWithPackage, type Method, type PackageErrorCode } from "./handlers";
import {
  INSTALL_REF_PATTERN,
  installCookieName,
  installCookiePath,
  type InstallErrorCode,
  type InstallFailure,
  type InstallSessionResult,
} from "./install-contracts";
import { createInstallLinkStore, type InstallLinkStore, type ResolvedInstallLink } from "./install-links";
import type { PackageStore } from "./store";

// The private install link flow (contract: ./install-contracts.ts). The secret reaches this server only
// in a JSON body, an HttpOnly cookie or an Authorization header, never in a path or query string, so
// request logs (path, query, user agent, referrer) do not record it. Logs here carry error class and
// code only.

export type InstallHandlerOptions = {
  /** Null when the database is not configured (503). */
  getLinkStore?: () => InstallLinkStore | null;
  getStore?: () => PackageStore | null;
  /** Milliseconds since the epoch, for the cookie lifetime. */
  now?: () => number;
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

// One cookie per link, sent back by the browser only to that link's download address, never readable by
// scripts and never sent from another site. Links opened in other tabs keep their own.
const cookieAttributes = (ref: string) => `Path=${installCookiePath(ref)}; HttpOnly; Secure; SameSite=Strict`;
const setCookie = (ref: string, token: string, maxAge: number) =>
  `${installCookieName(ref)}=${token}; Max-Age=${maxAge}; ${cookieAttributes(ref)}`;
const clearCookie = (ref: string) => `${installCookieName(ref)}=; Max-Age=0; ${cookieAttributes(ref)}`;

const CLOSED_MESSAGE =
  "이 설치 링크로는 받을 수 없습니다. 받은 링크를 다시 열어 주세요. 유효 기간이 지났거나 회수된 링크라면 새 링크가 필요합니다.\n" +
  "This install link can't be used. Open the link you received again; if it has expired or was revoked, you need a new one.";
const DOWNLOAD_MESSAGES: Partial<Record<DownloadErrorCode, string>> = {
  NOT_FOUND: CLOSED_MESSAGE,
  GONE: CLOSED_MESSAGE,
  RANGE_NOT_SATISFIABLE: "요청한 범위가 파일 크기를 벗어났습니다.\nThe requested range is outside the file.",
};
const UNAVAILABLE_MESSAGE =
  "지금은 설치 파일을 받을 수 없습니다. 잠시 후 다시 시도해 주세요.\n" +
  "The installer can't be downloaded right now. Please try again later.";

// respondWithPackage itself only refuses with RANGE_NOT_SATISFIABLE.
type DownloadErrorCode = InstallErrorCode | PackageErrorCode;

/**
 * POST /api/updates/v1/install/session with `{ "token": "<from the link's fragment>" }`. An open link
 * gets 200 with its `ref` and what it serves, and an HttpOnly cookie for that link's download address for
 * its remaining lifetime; malformed or unknown tokens get 404, closed links 410. Only the /install page of
 * this site may call it.
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
      const fields = asObjectWithKeys(body.value, ["token"]);
      if (!fields || typeof fields.token !== "string") return sessionFailure(400, "INVALID_REQUEST");
      const token = fields.token;
      // Malformed tokens never reach the database.
      if (!decodeBase64url(token, TOKEN_BYTES)) return sessionFailure(404, "NOT_FOUND");

      const links = deps.getLinkStore();
      if (!links) return sessionUnavailable("database is not configured");
      let link: ResolvedInstallLink | null;
      try {
        link = await links.resolve(sha256(token));
      } catch (error) {
        return sessionUnavailable("link lookup failed", error);
      }
      if (!link) return sessionFailure(404, "NOT_FOUND");
      const maxAge = Math.floor((Date.parse(link.expiresAt) - deps.now()) / 1000);
      if (!link.live || !(maxAge > 0)) return sessionFailure(410, "GONE");

      const result: InstallSessionResult = {
        ok: true,
        ref: link.ref,
        version: link.version,
        build: link.info.build,
        byteLength: link.info.byteLength,
        expiresAt: link.expiresAt,
      };
      return json(200, result, { "Set-Cookie": setCookie(link.ref, token, maxAge) });
    } catch (error) {
      console.error(LOG_PREFIX, "unexpected error", describeError(error));
      return sessionFailure(500, "INTERNAL_ERROR");
    }
  };
}

type RefParams = { params: Promise<{ ref: string }> };

/**
 * GET and HEAD /api/updates/v1/install/{ref}/Nokka.dmg: the package the link `ref` was issued for, whole
 * or one byte range, as an attachment. The secret comes from that link's cookie, or from
 * `Authorization: Bearer` for tools, and must belong to the link `ref`: a page's download and resume serve
 * exactly the link it shows. Every request is checked: once the link expires or is revoked or replaced,
 * its approval withdrawn or its package withdrawn, new requests (resumed ranges included) get 410. A
 * response already sending bytes is not cut off.
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
      const token = bearer ?? cookie;
      // A cookie that opens nothing any more is removed.
      const refuse = (status: number, code: DownloadErrorCode) =>
        downloadFailure(method, status, code, cookie !== null ? { "Set-Cookie": clearCookie(ref) } : {});
      if (token === null || !decodeBase64url(token, TOKEN_BYTES)) return refuse(404, "NOT_FOUND");

      const links = deps.getLinkStore();
      const store = deps.getStore();
      if (!links || !store) return downloadUnavailable(method, "database is not configured");
      let link: ResolvedInstallLink | null;
      try {
        link = await links.resolve(sha256(token));
      } catch (error) {
        return downloadUnavailable(method, "link lookup failed", error);
      }
      // Another link's secret does not open this address.
      if (!link || link.ref !== ref) return refuse(404, "NOT_FOUND");
      if (!link.live) return refuse(410, "GONE");

      const resolved = link;
      return respondWithPackage(request, method, store, resolved.info, {
        headers: {
          ...LINK_HEADERS,
          "Content-Disposition": `attachment; filename="Nokka-${resolved.version}.dmg"`,
        },
        refuse: (status, code, extra) => downloadFailure(method, status, code, extra),
        unavailable: (reason, error) => downloadUnavailable(method, reason, error),
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
    now: options.now ?? Date.now,
  };
}

function json(status: number, body: InstallSessionResult | InstallFailure, extra: Record<string, string> = {}) {
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
