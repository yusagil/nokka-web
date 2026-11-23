// @vitest-environment node
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UpdateAuthorization } from "@/lib/updates/registration/authorize";
import { createAppcastHandlers, createPackageHandlers, readOrigin } from "../handlers";
import type { FeedItem, PackageInfo, PackageStore } from "../store";

vi.mock("server-only", () => ({}));

const ORIGIN = "https://nokka-web.vercel.app";
const ACTIVE = "a".repeat(43);
const INACTIVE = "i".repeat(43);
const CHUNK = 64 * 1024;

const AUTH: Record<string, UpdateAuthorization> = {
  [ACTIVE]: { ok: true, installationId: "00000000-0000-4000-8000-000000000001", expiresAt: "2026-11-21T00:15:00.000Z" },
  [INACTIVE]: { ok: false, status: 403, code: "REGISTRATION_INACTIVE" },
};
const authorize = vi.fn(async (token: string | null): Promise<UpdateAuthorization> =>
  token === "down".padEnd(43, "x")
    ? { ok: false, status: 503, code: "UNAVAILABLE" }
    : (token && AUTH[token]) || { ok: false, status: 401, code: "INVALID_TOKEN" },
);

/** In-memory store with the same chunking as the database; counts every call. */
function memoryStore(bytes: Uint8Array, { build = 24, feed = true } = {}) {
  const calls: string[] = [];
  const info: PackageInfo = {
    build,
    byteLength: bytes.length,
    sha256Hex: createHash("sha256").update(bytes).digest("hex"),
    chunkSize: CHUNK,
    chunkCount: Math.ceil(bytes.length / CHUNK),
  };
  const item: FeedItem = {
    build,
    shortVersion: "2.7.0",
    minimumSystemVersion: "14.0",
    byteLength: bytes.length,
    edSignature: `${"B".repeat(86)}==`,
    targetCDHash: "a".repeat(40),
    releaseNotes: "notes",
    publishedAt: new Date("2026-11-21T00:00:00.000Z"),
  };
  let failReads = false;
  const store: PackageStore = {
    async currentFeedItem() {
      calls.push("feed");
      return feed ? item : null;
    },
    async publishedPackage(requested) {
      calls.push(`package:${requested}`);
      return requested === build ? info : null;
    },
    async readChunk(requested, index, offset, length) {
      calls.push(`chunk:${index}:${offset}:${length}`);
      if (failReads) throw Object.assign(new Error("db down"), { code: "ECONNRESET" });
      const start = index * CHUNK + offset;
      return bytes.slice(start, start + length);
    },
  };
  return { store, calls, info, failReads: () => (failReads = true) };
}

const synthetic = (size: number) => {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = (i * 31 + (i >> 9)) & 0xff;
  return bytes;
};

const call = async (
  handler: (request: Request, context: { params: Promise<{ build: string }> }) => Promise<Response>,
  { build = "24", token, method = "GET", headers = {} }: { build?: string; token?: string; method?: string; headers?: Record<string, string> } = {},
) =>
  handler(
    new Request(`${ORIGIN}/api/updates/v1/packages/${build}/Nokka.dmg`, {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    }),
    { params: Promise.resolve({ build }) },
  );

const expectPrivate = (response: Response) => {
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("vary")).toBe("Authorization");
};

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  authorize.mockClear();
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => errors.mockRestore());

describe("protected feed", () => {
  const feedRequest = (token?: string, method = "GET") =>
    new Request(`${ORIGIN}/api/updates/v1/appcast.xml`, {
      method,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });

  it("refuses missing, unknown and inactive tokens before reading the feed", async () => {
    const { store, calls } = memoryStore(synthetic(10));
    const { GET, HEAD } = createAppcastHandlers({ authorize, getStore: () => store, getOrigin: () => ORIGIN });
    for (const [token, status, code] of [
      [undefined, 401, "INVALID_TOKEN"],
      ["nope".padEnd(43, "n"), 401, "INVALID_TOKEN"],
      [INACTIVE, 403, "REGISTRATION_INACTIVE"],
      ["down".padEnd(43, "x"), 503, "UNAVAILABLE"],
    ] as const) {
      const response = await GET(feedRequest(token));
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ ok: false, code });
      expectPrivate(response);
      const head = await HEAD(feedRequest(token, "HEAD"));
      expect(head.status).toBe(status);
      expect(head.body).toBeNull();
      expectPrivate(head);
    }
    expect((await GET(feedRequest())).headers.get("www-authenticate")).toBe('Bearer realm="nokka-updates"');
    expect(calls).toEqual([]);
  });

  it("serves the RSS to an active registration, HEAD without a body", async () => {
    const { store } = memoryStore(synthetic(10));
    const { GET, HEAD } = createAppcastHandlers({ authorize, getStore: () => store, getOrigin: () => ORIGIN });
    const response = await GET(feedRequest(ACTIVE));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/rss+xml; charset=utf-8");
    expectPrivate(response);
    const xml = await response.text();
    expect(xml).toContain(`url="${ORIGIN}/api/updates/v1/packages/24/Nokka.dmg"`);
    expect(Number(response.headers.get("content-length"))).toBe(new TextEncoder().encode(xml).length);
    const head = await HEAD(feedRequest(ACTIVE, "HEAD"));
    expect(head.status).toBe(200);
    expect(head.body).toBeNull();
    expect(head.headers.get("content-length")).toBe(response.headers.get("content-length"));
  });

  it("serves an empty channel, and 503 when the database is missing or failing", async () => {
    const { store } = memoryStore(synthetic(10), { feed: false });
    const empty = await createAppcastHandlers({ authorize, getStore: () => store, getOrigin: () => ORIGIN }).GET(feedRequest(ACTIVE));
    expect(empty.status).toBe(200);
    expect(await empty.text()).not.toContain("<item>");
    const missing = await createAppcastHandlers({ authorize, getStore: () => null, getOrigin: () => ORIGIN }).GET(feedRequest(ACTIVE));
    expect(missing.status).toBe(503);
    expectPrivate(missing);
    const misconfigured = await createAppcastHandlers({ authorize, getStore: () => store, getOrigin: () => null }).GET(
      feedRequest(ACTIVE),
    );
    expect(misconfigured.status).toBe(503);
    const failing = await createAppcastHandlers({
      authorize,
      getOrigin: () => ORIGIN,
      getStore: () => ({ ...store, currentFeedItem: () => Promise.reject(new Error("down")) }),
    }).GET(feedRequest(ACTIVE));
    expect(failing.status).toBe(503);
  });
});

describe("feed origin", () => {
  it("uses the configured origin, production by default, and never the request host", async () => {
    expect(readOrigin(undefined)).toBe("https://nokka-web.vercel.app");
    expect(readOrigin("  ")).toBe("https://nokka-web.vercel.app");
    expect(readOrigin("http://127.0.0.1:3000")).toBe("http://127.0.0.1:3000");
    expect(readOrigin("https://qa.example/")).toBe("https://qa.example");
    for (const bad of ["https://qa.example/path", "ftp://qa.example", "qa.example", "https://user@qa.example"]) {
      expect(readOrigin(bad), bad).toBeNull();
    }
    const { store } = memoryStore(synthetic(10));
    const response = await createAppcastHandlers({ authorize, getStore: () => store, getOrigin: () => ORIGIN }).GET(
      new Request("http://localhost:3000/api/updates/v1/appcast.xml", {
        headers: { authorization: `Bearer ${ACTIVE}`, "x-forwarded-host": "evil.example", "x-forwarded-proto": "http" },
      }),
    );
    expect(await response.text()).toContain(`url="${ORIGIN}/api/updates/v1/packages/24/Nokka.dmg"`);
  });
});

describe("protected package", () => {
  const size = CHUNK * 3 + 123;
  const bytes = synthetic(size);

  it("checks access before the build number, the package and conditional headers", async () => {
    const { store, calls } = memoryStore(bytes);
    const { GET, HEAD } = createPackageHandlers({ authorize, getStore: () => store });
    for (const token of [undefined, "nope".padEnd(43, "n"), INACTIVE]) {
      const headerSets: Record<string, string>[] = [
        {},
        { range: "bytes=0-9" },
        { "if-none-match": "*" },
        { "if-range": '"x"', range: "bytes=0-1" },
      ];
      for (const headers of headerSets) {
        for (const build of ["24", "999", "0024", "abc"]) {
          const response = await call(GET, { token, headers, build });
          expect([401, 403]).toContain(response.status);
          expectPrivate(response);
          for (const name of ["content-range", "etag", "accept-ranges", "location"]) {
            expect(response.headers.has(name)).toBe(false);
          }
          expect(new Uint8Array(await response.arrayBuffer()).length).toBeLessThan(64);
          const head = await call(HEAD, { token, headers, build, method: "HEAD" });
          expect([401, 403]).toContain(head.status);
          expect(head.body).toBeNull();
        }
      }
    }
    expect(calls).toEqual([]);
  });

  it("answers 404 for builds that are not published, after access", async () => {
    const { store, calls } = memoryStore(bytes);
    const { GET } = createPackageHandlers({ authorize, getStore: () => store });
    for (const build of ["23", "0", "024", "-1", "2147483648", "99999999999"]) {
      const response = await call(GET, { token: ACTIVE, build });
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ ok: false, code: "NOT_FOUND" });
      expectPrivate(response);
    }
    expect(calls).toEqual(["package:23"]);
  });

  it("streams the whole file chunk by chunk with its length and validators", async () => {
    const { store, calls, info } = memoryStore(bytes);
    const response = await call(createPackageHandlers({ authorize, getStore: () => store }).GET, { token: ACTIVE });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/x-apple-diskimage");
    expect(response.headers.get("content-length")).toBe(String(size));
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("etag")).toBe(`"${info.sha256Hex}"`);
    expectPrivate(response);
    const received = new Uint8Array(await response.arrayBuffer());
    expect(createHash("sha256").update(received).digest("hex")).toBe(info.sha256Hex);
    expect(calls.filter((c) => c.startsWith("chunk"))).toEqual([
      `chunk:0:0:${CHUNK}`,
      `chunk:1:0:${CHUNK}`,
      `chunk:2:0:${CHUNK}`,
      "chunk:3:0:123",
    ]);
  });

  it("serves single ranges across chunk boundaries and refuses the rest with 416", async () => {
    const { store, calls } = memoryStore(bytes);
    const { GET } = createPackageHandlers({ authorize, getStore: () => store });
    for (const [header, start, end] of [
      ["bytes=0-0", 0, 0],
      [`bytes=${CHUNK - 1}-${CHUNK}`, CHUNK - 1, CHUNK],
      [`bytes=${CHUNK - 10}-${CHUNK * 2 + 10}`, CHUNK - 10, CHUNK * 2 + 10],
      ["bytes=-1", size - 1, size - 1],
      [`bytes=${size - 5}-`, size - 5, size - 1],
      [`bytes=5-${size * 2}`, 5, size - 1],
    ] as const) {
      const response = await call(GET, { token: ACTIVE, headers: { range: header } });
      expect(response.status, header).toBe(206);
      expect(response.headers.get("content-type")).toBe("application/x-apple-diskimage");
      expect(response.headers.get("content-range")).toBe(`bytes ${start}-${end}/${size}`);
      expect(response.headers.get("content-length")).toBe(String(end - start + 1));
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes.slice(start, end + 1));
    }
    expect(calls).toContain(`chunk:0:${CHUNK - 10}:10`);
    expect(calls).toContain("chunk:2:0:11");
    for (const header of [`bytes=${size}-`, "bytes=0-1,4-5", "items=0-1"]) {
      const response = await call(GET, { token: ACTIVE, headers: { range: header } });
      expect(response.status, header).toBe(416);
      expect(response.headers.get("content-range")).toBe(`bytes */${size}`);
      expect(await response.json()).toEqual({ ok: false, code: "RANGE_NOT_SATISFIABLE" });
      expectPrivate(response);
    }
  });

  it("answers HEAD without bytes, honours If-None-Match and drops a range for a stale If-Range", async () => {
    const { store, calls, info } = memoryStore(bytes);
    const { GET, HEAD } = createPackageHandlers({ authorize, getStore: () => store });
    const head = await call(HEAD, { token: ACTIVE, method: "HEAD", headers: { range: "bytes=0-9" } });
    expect(head.status).toBe(200);
    expect(head.body).toBeNull();
    expect(head.headers.get("content-type")).toBe("application/x-apple-diskimage");
    expect(head.headers.get("content-length")).toBe(String(size));
    expect(calls.some((c) => c.startsWith("chunk"))).toBe(false);

    const notModified = await call(GET, { token: ACTIVE, headers: { "if-none-match": `"${info.sha256Hex}"` } });
    expect(notModified.status).toBe(304);
    expect(notModified.body).toBeNull();
    expectPrivate(notModified);

    const stale = await call(GET, { token: ACTIVE, headers: { range: "bytes=0-9", "if-range": '"other"' } });
    expect(stale.status).toBe(200);
    expect(stale.headers.get("content-length")).toBe(String(size));
    await stale.body?.cancel();
    const fresh = await call(GET, { token: ACTIVE, headers: { range: "bytes=0-9", "if-range": `"${info.sha256Hex}"` } });
    expect(fresh.status).toBe(206);
  });

  it("reads only as fast as the client and stops when it goes away", async () => {
    const { store, calls } = memoryStore(synthetic(CHUNK * 20));
    const response = await call(createPackageHandlers({ authorize, getStore: () => store }).GET, { token: ACTIVE });
    const reader = response.body!.getReader();
    await reader.read();
    await new Promise((resolve) => setTimeout(resolve, 20));
    // One chunk delivered, at most one more read ahead.
    expect(calls.filter((c) => c.startsWith("chunk")).length).toBeLessThanOrEqual(3);
    await reader.cancel();
    const after = calls.length;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls.length).toBe(after);
  });

  it("answers 503 when the database is missing or the first read fails, and cuts the stream on a later failure", async () => {
    const missing = await call(createPackageHandlers({ authorize, getStore: () => null }).GET, { token: ACTIVE });
    expect(missing.status).toBe(503);
    expectPrivate(missing);

    const first = memoryStore(bytes);
    first.failReads();
    const failed = await call(createPackageHandlers({ authorize, getStore: () => first.store }).GET, { token: ACTIVE });
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ ok: false, code: "UNAVAILABLE" });

    const later = memoryStore(bytes);
    const response = await call(createPackageHandlers({ authorize, getStore: () => later.store }).GET, { token: ACTIVE });
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    await reader.read();
    later.failReads();
    await expect(
      (async () => {
        for (;;) if ((await reader.read()).done) break;
      })(),
    ).rejects.toThrow();
  });
});
