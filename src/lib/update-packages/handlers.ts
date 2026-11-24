import "server-only";
import { getDatabase } from "@/lib/applications/db";
import {
  authorizeUpdates,
  readBearerToken,
  type UpdateAuthorization,
} from "@/lib/updates/registration/authorize";
import { DEFAULT_SIGNING_ORIGIN } from "@/lib/updates/registration/contracts";
import { renderAppcast } from "./appcast";
import { matchesIfNoneMatch, parseRange, rangeStillValid, type ByteRange } from "./range";
import { createPackageStore, type PackageInfo, type PackageStore } from "./store";

export type PackageErrorCode =
  | "INVALID_TOKEN"
  | "REGISTRATION_INACTIVE"
  | "NOT_FOUND"
  | "RANGE_NOT_SATISFIABLE"
  | "UNAVAILABLE"
  | "INTERNAL_ERROR";

export type PackageHandlerOptions = {
  authorize?: (token: string | null) => Promise<UpdateAuthorization>;
  /** Null when the database is not configured; answered with 503 after the access check. */
  getStore?: () => PackageStore | null;
  /**
   * The origin the feed's download links use: the one the app is built for and signs its proofs with
   * (UPDATES_SIGNING_ORIGIN, else production). Never the request's Host or forwarding headers. Null
   * when misconfigured (503).
   */
  getOrigin?: () => string | null;
};

type Method = "GET" | "HEAD";
type BuildParams = { params: Promise<{ build: string }> };

const LOG_PREFIX = "[update-packages]";
// Builds are integer columns: 1 to 2^31 - 1, written without leading zeros.
const BUILD_PATTERN = /^[1-9][0-9]{0,9}$/;
const MAX_BUILD = 2_147_483_647;
// Every protected answer, errors and HEAD included, is private to its bearer and never stored.
const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Authorization",
  "X-Content-Type-Options": "nosniff",
} as const;
// The disk image's own type. Vercel's CDN compresses application/octet-stream for clients that accept br
// (browsers, and URLSession over HTTPS), dropping Content-Length and Accept-Ranges and weakening the ETag,
// so a download shows no size and can not resume; it leaves this type as it is. Cache-Control:
// no-transform does not stop it.
const PACKAGE_CONTENT_TYPE = "application/x-apple-diskimage";

/** GET and HEAD /api/updates/v1/appcast.xml */
export function createAppcastHandlers(options: PackageHandlerOptions = {}) {
  const deps = withDefaults(options);
  const handle = (method: Method) =>
    withErrorBoundary(method, async (request: Request) => {
      const denied = await checkAccess(request, method, deps);
      if (denied) return denied;

      const store = deps.getStore();
      const origin = deps.getOrigin();
      if (!store || !origin) return unavailable(method, "database or origin is not configured");
      let xml: string;
      try {
        xml = renderAppcast(await store.currentFeedItem(), origin);
      } catch (error) {
        return unavailable(method, "feed lookup failed", error);
      }
      const body = new TextEncoder().encode(xml);
      const headers = {
        ...PRIVATE_HEADERS,
        "Content-Type": "application/rss+xml; charset=utf-8",
        "Content-Length": String(body.byteLength),
      };
      return new Response(method === "HEAD" ? null : body, { status: 200, headers });
    });
  return { GET: handle("GET"), HEAD: handle("HEAD") };
}

/** GET and HEAD /api/updates/v1/packages/{build}/Nokka.dmg, with an optional single byte range. */
export function createPackageHandlers(options: PackageHandlerOptions = {}) {
  const deps = withDefaults(options);
  const handle = (method: Method) =>
    withErrorBoundary(method, async (request: Request, context: BuildParams) => {
      // Before the build number, the package row and any conditional header.
      const denied = await checkAccess(request, method, deps);
      if (denied) return denied;

      const raw = (await context.params).build;
      const build = BUILD_PATTERN.test(raw) ? Number(raw) : NaN;
      if (!(build <= MAX_BUILD)) return failure(method, 404, "NOT_FOUND");

      const store = deps.getStore();
      if (!store) return unavailable(method, "database is not configured");
      let info: PackageInfo | null;
      try {
        info = await store.publishedPackage(build);
      } catch (error) {
        return unavailable(method, "package lookup failed", error);
      }
      if (!info) return failure(method, 404, "NOT_FOUND");

      const etag = `"${info.sha256Hex}"`;
      const size = info.byteLength;
      const common = { ...PRIVATE_HEADERS, "Accept-Ranges": "bytes", ETag: etag };
      if (matchesIfNoneMatch(request.headers.get("if-none-match"), etag)) {
        return new Response(null, { status: 304, headers: common });
      }

      const rangeHeader = rangeStillValid(request.headers.get("if-range"), etag)
        ? request.headers.get("range")
        : null;
      // HEAD describes the whole file, as GET without a range would.
      const requested = method === "HEAD" ? { kind: "full" as const } : parseRange(rangeHeader, size);
      if (requested.kind === "unsatisfiable") {
        return failure(method, 416, "RANGE_NOT_SATISFIABLE", { "Content-Range": `bytes */${size}` });
      }
      const range = requested.kind === "partial" ? requested.range : { start: 0, end: size - 1 };
      const headers: Record<string, string> = {
        ...common,
        "Content-Type": PACKAGE_CONTENT_TYPE,
        "Content-Length": String(range.end - range.start + 1),
      };
      if (requested.kind === "partial") headers["Content-Range"] = `bytes ${range.start}-${range.end}/${size}`;
      const status = requested.kind === "partial" ? 206 : 200;
      if (method === "HEAD") return new Response(null, { status, headers });

      // The first chunk is read before the status line is sent, so a database outage is a 503, not a
      // cut-off 200. Later failures end the stream early; the next request is checked again.
      let stream: ReadableStream<Uint8Array>;
      try {
        stream = await streamRange(store, info, range);
      } catch (error) {
        return unavailable(method, "package read failed", error);
      }
      return new Response(stream, { status, headers });
    });
  return { GET: handle("GET"), HEAD: handle("HEAD") };
}

/**
 * The bytes of `range` read chunk by chunk, one short query per chunk, only as fast as the client takes
 * them (at most one chunk read ahead). Cancelling the response stops the reads.
 */
export async function streamRange(
  store: PackageStore,
  info: PackageInfo,
  range: ByteRange,
): Promise<ReadableStream<Uint8Array>> {
  const lastIndex = Math.floor(range.end / info.chunkSize);
  let index = Math.floor(range.start / info.chunkSize);
  let cancelled = false;

  const readNext = async (): Promise<Uint8Array> => {
    const chunkStart = index * info.chunkSize;
    const from = Math.max(range.start, chunkStart) - chunkStart;
    const to = Math.min(range.end, chunkStart + info.chunkSize - 1) - chunkStart;
    const bytes = await store.readChunk(info.build, index, from, to - from + 1);
    if (!bytes || bytes.byteLength !== to - from + 1) {
      throw Object.assign(new Error("package chunk is missing or short"), { code: "CHUNK_MISMATCH" });
    }
    index++;
    return bytes;
  };

  const first = await readNext();
  let pending: Uint8Array | null = first;
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          if (pending) {
            controller.enqueue(pending);
            pending = null;
          } else {
            const bytes = await readNext();
            if (cancelled) return;
            controller.enqueue(bytes);
          }
          if (index > lastIndex) controller.close();
        } catch (error) {
          console.error(LOG_PREFIX, "package stream stopped", describeError(error));
          controller.error(error);
        }
      },
      cancel() {
        cancelled = true;
        pending = null;
      },
    },
    { highWaterMark: 1 },
  );
}

async function checkAccess(
  request: Request,
  method: Method,
  deps: Required<PackageHandlerOptions>,
): Promise<Response | null> {
  const auth = await deps.authorize(readBearerToken(request.headers));
  if (auth.ok) return null;
  const extra: Record<string, string> =
    auth.status === 401
      ? {
          "WWW-Authenticate": request.headers.has("authorization")
            ? 'Bearer realm="nokka-updates", error="invalid_token"'
            : 'Bearer realm="nokka-updates"',
        }
      : {};
  return failure(method, auth.status, auth.code, extra);
}

function withDefaults(options: PackageHandlerOptions): Required<PackageHandlerOptions> {
  return {
    authorize: options.authorize ?? authorizeUpdates,
    getOrigin: options.getOrigin ?? (() => readOrigin(process.env.UPDATES_SIGNING_ORIGIN)),
    getStore:
      options.getStore ??
      (() => {
        const sql = getDatabase();
        return sql ? createPackageStore(sql) : null;
      }),
  };
}

/** UPDATES_SIGNING_ORIGIN as an exact http(s) origin, the production origin when unset, else null. */
export function readOrigin(value: string | undefined): string | null {
  const configured = value?.trim() || DEFAULT_SIGNING_ORIGIN;
  try {
    const url = new URL(configured);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin === configured.replace(/\/$/, "") ? url.origin : null;
  } catch {
    return null;
  }
}

function withErrorBoundary<Args extends [Request, ...unknown[]]>(
  method: Method,
  handler: (...args: Args) => Promise<Response>,
) {
  return async (...args: Args): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (error) {
      console.error(LOG_PREFIX, "unexpected error", describeError(error));
      return failure(method, 500, "INTERNAL_ERROR");
    }
  };
}

function unavailable(method: Method, reason: string, error?: unknown): Response {
  console.error(LOG_PREFIX, reason, error === undefined ? "" : describeError(error));
  return failure(method, 503, "UNAVAILABLE");
}

function failure(
  method: Method,
  status: number,
  code: PackageErrorCode,
  extra: Record<string, string> = {},
): Response {
  const body = new TextEncoder().encode(JSON.stringify({ ok: false, code }));
  const headers = {
    ...PRIVATE_HEADERS,
    ...extra,
    "Content-Type": "application/json",
    "Content-Length": String(body.byteLength),
  };
  return new Response(method === "HEAD" ? null : body, { status, headers });
}

/** Error class and code only. */
function describeError(error: unknown) {
  if (!(error instanceof Error)) return { name: typeof error };
  const code = (error as { code?: unknown }).code;
  return { name: error.name, code: typeof code === "string" ? code : undefined };
}
