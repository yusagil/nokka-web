// @vitest-environment node
import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installCookieName } from "../install-contracts";
import { createInstallDownloadHandlers, createInstallSessionHandler, readCookie } from "../install-handlers";
import type { ExchangeOutcome, InstallLinkStore, ResolvedInstallLink } from "../install-links";
import type { PackageInfo, PackageStore } from "../store";

vi.mock("server-only", () => ({}));

const ORIGIN = "https://nokka-web.vercel.app";
const CHUNK = 64 * 1024;
// Synthetic 43-character tokens (32 bytes, base64url) for tests only.
const OPEN = "o".repeat(42) + "A";
const CLOSED = "c".repeat(42) + "A";
const UNKNOWN = "u".repeat(42) + "A";
const EXPIRED_NOW = "e".repeat(42) + "A";
// A second open link (another request, a later build), as if opened in another tab.
const OTHER = "t".repeat(42) + "A";
// Synthetic session secrets the session handler hands out, in order (same shape as tokens).
const SECRETS = ["1", "2", "3", "4"].map((digit) => digit.repeat(42) + "A");
// Synthetic link refs (UUID v4, not secret).
const REF = "0e4f2a8c-1b3d-4c5e-8f60-71829304a5b6";
const REF_CLOSED = "1e4f2a8c-1b3d-4c5e-8f60-71829304a5b6";
const REF_EXPIRED = "2e4f2a8c-1b3d-4c5e-8f60-71829304a5b6";
const REF_OTHER = "3e4f2a8c-1b3d-4c5e-8f60-71829304a5b6";
const REF_UNKNOWN = "4e4f2a8c-1b3d-4c5e-8f60-71829304a5b6";

const synthetic = (size: number) => {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = (i * 17 + (i >> 8)) & 0xff;
  return bytes;
};
const digestOf = (token: string) => createHash("sha256").update(token).digest("hex");

const packageInfo = (build: number, bytes: Uint8Array): PackageInfo => ({
  build,
  byteLength: bytes.length,
  sha256Hex: createHash("sha256").update(bytes).digest("hex"),
  chunkSize: CHUNK,
  chunkCount: Math.ceil(bytes.length / CHUNK),
});

function setup(bytes: Uint8Array) {
  const calls: string[] = [];
  const info = packageInfo(24, bytes);
  const otherBytes = synthetic(bytes.length + 7).map((byte) => byte ^ 0x5a);
  const otherInfo = packageInfo(25, otherBytes);
  const link = (
    id: string,
    ref: string,
    live: boolean,
    { expiresAt = "2026-11-26T00:00:00.000Z", version = "2.7.0", of = info } = {},
  ): ResolvedInstallLink => ({ id, ref, live, version, expiresAt, info: of });
  // By token: the link, its remaining seconds by the database's clock, and whether its token was used.
  const links: Record<string, { link: ResolvedInstallLink; maxAge: number; used: boolean }> = {
    [digestOf(OPEN)]: { link: link("1", REF, true), maxAge: 3 * 24 * 3600, used: false },
    [digestOf(CLOSED)]: { link: link("2", REF_CLOSED, false), maxAge: 3600, used: false },
    // Open in the database's view, but with less than a second left.
    [digestOf(EXPIRED_NOW)]: { link: link("3", REF_EXPIRED, true), maxAge: 0, used: false },
    [digestOf(OTHER)]: { link: link("4", REF_OTHER, true, { version: "2.7.1", of: otherInfo }), maxAge: 7200, used: false },
  };
  // By session secret, as the store holds them after an exchange.
  const sessions: Record<string, ResolvedInstallLink> = {};
  let handedOut = 0;
  const failures = { exchange: false, resolve: false, record: false, read: false };
  const linkStore: InstallLinkStore = {
    issue: vi.fn(),
    revoke: vi.fn(),
    async exchange(tokenHash, sessionHash): Promise<ExchangeOutcome> {
      calls.push("exchange");
      if (failures.exchange) throw Object.assign(new Error("db down"), { code: "ECONNRESET" });
      const entry = links[tokenHash.toString("hex")];
      if (!entry) return { kind: "not_found" };
      if (!entry.link.live || entry.maxAge < 1) return { kind: "gone" };
      if (entry.used) return { kind: "used", link: entry.link };
      entry.used = true;
      sessions[sessionHash.toString("hex")] = entry.link;
      return { kind: "opened", link: entry.link, maxAge: entry.maxAge };
    },
    async resolveSession(sessionHash) {
      calls.push("resolve");
      if (failures.resolve) throw Object.assign(new Error("db down"), { code: "ECONNRESET" });
      return sessions[sessionHash.toString("hex")] ?? null;
    },
    async recordDownload(id) {
      calls.push(`record:${id}`);
      if (failures.record) throw Object.assign(new Error("db down"), { code: "ECONNRESET" });
    },
  };
  const store: PackageStore = {
    currentFeedItem: vi.fn(),
    publishedPackage: vi.fn(),
    async readChunk(build, index, offset, length) {
      calls.push(`chunk:${index}`);
      if (failures.read) throw Object.assign(new Error("db down"), { code: "ECONNRESET" });
      const start = index * CHUNK + offset;
      return (build === 25 ? otherBytes : bytes).slice(start, start + length);
    },
  };
  const deps = { getLinkStore: () => linkStore, getStore: () => store, newSessionSecret: () => SECRETS[handedOut++] };
  const session = createInstallSessionHandler(deps);
  const download = createInstallDownloadHandlers(deps);
  const exchange = (body: unknown, headers: Record<string, string | null> = {}) => {
    const merged: Record<string, string | null> = {
      "content-type": "application/json",
      "sec-fetch-site": "same-origin",
      ...headers,
    };
    const init: Record<string, string> = {};
    for (const [key, value] of Object.entries(merged)) if (value !== null) init[key] = value;
    return session(
      new Request(`${ORIGIN}/api/updates/v1/install/session`, {
        method: "POST",
        headers: init,
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    );
  };
  /** `cookie`: a secret in `ref`'s own cookie; `cookies`: a raw Cookie header instead. */
  const get = ({
    ref = REF,
    cookie,
    cookies,
    bearer,
    method = "GET",
    headers = {},
  }: {
    ref?: string;
    cookie?: string;
    cookies?: string;
    bearer?: string;
    method?: "GET" | "HEAD";
    headers?: Record<string, string>;
  } = {}) =>
    download[method](
      new Request(`${ORIGIN}/api/updates/v1/install/${ref}/Nokka.dmg`, {
        method,
        headers: {
          ...(cookie !== undefined ? { cookie: `other=1; ${installCookieName(ref)}=${cookie}` } : {}),
          ...(cookies !== undefined ? { cookie: cookies } : {}),
          ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
          ...headers,
        },
      }),
      { params: Promise.resolve({ ref }) },
    );
  /** Opens `token` as the page does and returns the session secret its cookie carries. */
  const open = async (token: string) => {
    const response = await exchange({ token });
    expect(response.status).toBe(200);
    const secret = /^__Secure-nokka-install-[0-9a-f-]+=([^;]+);/.exec(response.headers.get("set-cookie") ?? "")?.[1];
    expect(secret).toBeDefined();
    return secret!;
  };
  /** A session the store holds for `token`'s link, as if opened before it closed. */
  const seedSession = (secret: string, token: string) => {
    sessions[digestOf(secret)] = links[digestOf(token)].link;
  };
  return { exchange, open, seedSession, get, calls, info, otherInfo, failures, links, sessions };
}

const expectLinkHeaders = (response: Response) => {
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
};

const cleared = (ref: string) =>
  `${installCookieName(ref)}=; Max-Age=0; Path=/api/updates/v1/install/${ref}; HttpOnly; Secure; SameSite=Strict`;

const expectRefused = async (response: Response, status: number, { allow = [] as string[] } = {}) => {
  expect(response.status).toBe(status);
  expectLinkHeaders(response);
  expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  for (const name of ["etag", "accept-ranges", "content-range", "content-disposition", "location"]) {
    if (!allow.includes(name)) expect(response.headers.has(name)).toBe(false);
  }
  return response.text();
};

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  // No secret in any log line.
  const logged = JSON.stringify(errors.mock.calls);
  for (const token of [OPEN, CLOSED, UNKNOWN, EXPIRED_NOW, OTHER, ...SECRETS]) expect(logged).not.toContain(token);
  errors.mockRestore();
});

describe("install link session (token in the body once, session cookie back)", () => {
  it("opens a link once with the link's own HttpOnly, Secure, SameSite=Strict cookie holding a new session secret", async () => {
    const { exchange, links } = setup(synthetic(1000));
    const response = await exchange({ token: OPEN });
    expect(response.status).toBe(200);
    expectLinkHeaders(response);
    expect(await response.json()).toEqual({
      ok: true,
      ref: REF,
      version: "2.7.0",
      build: 24,
      byteLength: 1000,
      expiresAt: "2026-11-26T00:00:00.000Z",
    });
    // The session secret, never the link's token; the lifetime is the store's (the database's clock).
    expect(response.headers.get("set-cookie")).toBe(
      `__Secure-nokka-install-${REF}=${SECRETS[0]}; Max-Age=${3 * 24 * 3600}; Path=/api/updates/v1/install/${REF}; HttpOnly; Secure; SameSite=Strict`,
    );
    expect(links[digestOf(OPEN)].used).toBe(true);
    // Another link gets another cookie, with another secret, for another address.
    const other = await exchange({ token: OTHER });
    expect(await other.json()).toMatchObject({ ref: REF_OTHER, build: 25, version: "2.7.1" });
    expect(other.headers.get("set-cookie")).toBe(
      `__Secure-nokka-install-${REF_OTHER}=${SECRETS[1]}; Max-Age=7200; Path=/api/updates/v1/install/${REF_OTHER}; HttpOnly; Secure; SameSite=Strict`,
    );
  });

  it("refuses the token once it was exchanged (410 USED) with the link's ref and what it serves, but no session", async () => {
    const { exchange, open, get, sessions } = setup(synthetic(1000));
    const secret = await open(OPEN);
    for (const headers of [{}, { "sec-fetch-site": null }] as Record<string, string | null>[]) {
      const again = await exchange({ token: OPEN }, headers);
      expect(again.status).toBe(410);
      const body = await again.json();
      expect(body).toEqual({
        ok: false,
        code: "USED",
        ref: REF,
        version: "2.7.0",
        build: 24,
        byteLength: 1000,
        expiresAt: "2026-11-26T00:00:00.000Z",
      });
      // Nothing secret: neither the token nor any session secret.
      for (const value of [OPEN, ...SECRETS]) expect(JSON.stringify(body)).not.toContain(value);
      expect(again.headers.has("set-cookie")).toBe(false);
      expectLinkHeaders(again);
    }
    // The refused calls stored no session: the one from the first opening is the only one.
    expect(Object.keys(sessions)).toEqual([digestOf(secret)]);
    // The browser holding the session finds the download at that ref; one without it does not.
    expect((await get({ ref: REF, cookie: secret, method: "HEAD" })).status).toBe(200);
    expect((await get({ cookie: secret })).status).toBe(200);
    await expectRefused(await get({ ref: REF, method: "HEAD" }), 404);
    // The token itself is no session: as a cookie or a bearer token it opens nothing.
    await expectRefused(await get({ cookie: OPEN }), 404);
    await expectRefused(await get({ bearer: OPEN }), 404);
  });

  it("answers a plain 410 GONE, naming nothing, once a used link is closed", async () => {
    const { exchange, open, get, links } = setup(synthetic(1000));
    const secret = await open(OPEN);
    links[digestOf(OPEN)].link.live = false;
    const closed = await exchange({ token: OPEN });
    expect(closed.status).toBe(410);
    expect(await closed.json()).toEqual({ ok: false, code: "GONE" });
    expect(closed.headers.has("set-cookie")).toBe(false);
    await expectRefused(await get({ cookie: secret, method: "HEAD" }), 410);
  });

  it("answers 404 for malformed or unknown tokens and 410 for closed ones, setting no cookie and using no token", async () => {
    const { exchange, calls, links } = setup(synthetic(1000));
    for (const token of ["short", `${OPEN}x`, OPEN.slice(0, 42) + "B", "a".repeat(42) + "="]) {
      const response = await exchange({ token });
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ ok: false, code: "NOT_FOUND" });
    }
    expect(calls).toEqual([]);
    for (const [token, status, code] of [
      [UNKNOWN, 404, "NOT_FOUND"],
      [CLOSED, 410, "GONE"],
      // Less than a second left: not worth a cookie, and the token stays unused.
      [EXPIRED_NOW, 410, "GONE"],
    ] as const) {
      const response = await exchange({ token });
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ ok: false, code });
      expect(response.headers.has("set-cookie")).toBe(false);
      expectLinkHeaders(response);
    }
    expect([links[digestOf(CLOSED)].used, links[digestOf(EXPIRED_NOW)].used]).toEqual([false, false]);
  });

  it("takes only a same-origin JSON body with exactly the token, and a refusal leaves the token unused", async () => {
    const { exchange, calls } = setup(synthetic(1000));
    const cases: [unknown, Record<string, string | null>, number, string][] = [
      [{ token: OPEN }, { "sec-fetch-site": "cross-site" }, 403, "FORBIDDEN"],
      [{ token: OPEN }, { "sec-fetch-site": "same-site" }, 403, "FORBIDDEN"],
      [{ token: OPEN }, { "content-type": "text/plain" }, 415, "UNSUPPORTED_MEDIA_TYPE"],
      [{ token: OPEN, build: 25 }, {}, 400, "INVALID_REQUEST"],
      [{ token: 42 }, {}, 400, "INVALID_REQUEST"],
      ["not json", {}, 400, "INVALID_REQUEST"],
      [{ token: "x".repeat(2000) }, {}, 413, "PAYLOAD_TOO_LARGE"],
    ];
    for (const [body, headers, status, code] of cases) {
      const response = await exchange(body, headers);
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ ok: false, code });
      expect(response.headers.has("set-cookie")).toBe(false);
    }
    expect(calls).toEqual([]);
    // Tools that send no Sec-Fetch-Site (curl) are fine, and the refused attempts used nothing.
    expect((await exchange({ token: OPEN }, { "sec-fetch-site": null })).status).toBe(200);
  });

  it("answers 503 when the exchange fails, and a retry opens the still unused token", async () => {
    const { exchange, failures, links } = setup(synthetic(10));
    failures.exchange = true;
    const response = await exchange({ token: OPEN });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, code: "UNAVAILABLE" });
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(links[digestOf(OPEN)].used).toBe(false);
    failures.exchange = false;
    const retried = await exchange({ token: OPEN });
    expect(retried.status).toBe(200);
    // The failed attempt's secret was never handed out; the retry's is new.
    expect(retried.headers.get("set-cookie")).toContain(`=${SECRETS[1]};`);
  });

  it("answers 503 without a database", async () => {
    const session = createInstallSessionHandler({ getLinkStore: () => null, getStore: () => null });
    const response = await session(
      new Request(`${ORIGIN}/api/updates/v1/install/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: OPEN }),
      }),
    );
    expect(response.status).toBe(503);
  });
});

describe("install link download (the link's own address, its session cookie or bearer)", () => {
  it("downloads the whole package as an attachment with the session cookie or as a bearer token, and counts it", async () => {
    const bytes = synthetic(3 * CHUNK + 123);
    const { open, get, calls, info } = setup(bytes);
    const secret = await open(OPEN);
    for (const credential of [{ cookie: secret }, { bearer: secret }]) {
      const response = await get(credential);
      expect(response.status).toBe(200);
      expectLinkHeaders(response);
      expect(response.headers.get("content-disposition")).toBe('attachment; filename="Nokka-2.7.0.dmg"');
      expect(response.headers.get("content-type")).toBe("application/x-apple-diskimage");
      expect(response.headers.get("content-length")).toBe(String(bytes.length));
      expect(response.headers.get("etag")).toBe(`"${info.sha256Hex}"`);
      expect(response.headers.has("set-cookie")).toBe(false);
      const body = new Uint8Array(await response.arrayBuffer());
      expect(createHash("sha256").update(body).digest("hex")).toBe(info.sha256Hex);
    }
    expect(calls.filter((c) => c.startsWith("record"))).toEqual(["record:1", "record:1"]);
  });

  it("serves HEAD, 304, ranges and resumes, counting only responses with bytes", async () => {
    const bytes = synthetic(2 * CHUNK + 10);
    const { open, get, calls, info } = setup(bytes);
    const secret = await open(OPEN);
    const head = await get({ cookie: secret, method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.body).toBeNull();
    expect(head.headers.get("content-type")).toBe("application/x-apple-diskimage");
    expect(head.headers.get("content-length")).toBe(String(bytes.length));

    expect((await get({ cookie: secret, headers: { "if-none-match": `"${info.sha256Hex}"` } })).status).toBe(304);

    // A browser resuming: an open range checked against the ETag, with the same session.
    const resumed = await get({ cookie: secret, headers: { range: `bytes=${CHUNK - 5}-`, "if-range": `"${info.sha256Hex}"` } });
    expect(resumed.status).toBe(206);
    expect(resumed.headers.get("content-type")).toBe("application/x-apple-diskimage");
    expect(resumed.headers.get("content-range")).toBe(`bytes ${CHUNK - 5}-${bytes.length - 1}/${bytes.length}`);
    expect(Array.from(new Uint8Array(await resumed.arrayBuffer()))).toEqual(Array.from(bytes.slice(CHUNK - 5)));

    // Another ETag: the whole file again rather than a mismatched part.
    const changed = await get({ cookie: secret, headers: { range: "bytes=10-", "if-range": '"other"' } });
    expect(changed.status).toBe(200);
    await changed.arrayBuffer();

    const outside = await get({ cookie: secret, headers: { range: `bytes=${bytes.length}-` } });
    expect(await expectRefused(outside, 416, { allow: ["content-range"] })).toContain("outside the file");
    expect(calls.filter((c) => c.startsWith("record"))).toEqual(["record:1", "record:1"]);
  });

  it("refuses requests without a session (404) or for a closed link (410), clearing the cookie", async () => {
    const { seedSession, get, calls } = setup(synthetic(1000));
    const none = await get();
    expect(await expectRefused(none, 404)).toContain("the browser that first opened the install link");
    expect(none.headers.has("set-cookie")).toBe(false);

    // Malformed, unknown, and a cookie from before links opened once (it carried the link's token).
    for (const cookie of ["", "short", UNKNOWN, OPEN]) {
      const response = await get({ cookie });
      await expectRefused(response, 404);
      expect(response.headers.get("set-cookie")).toBe(cleared(REF));
    }
    seedSession(SECRETS[3], CLOSED);
    const closed = await get({ ref: REF_CLOSED, cookie: SECRETS[3] });
    expect(await expectRefused(closed, 410)).toContain("이 설치 링크로는 받을 수 없습니다");
    expect(closed.headers.get("set-cookie")).toBe(cleared(REF_CLOSED));
    const closedHead = await get({ ref: REF_CLOSED, cookie: SECRETS[3], method: "HEAD" });
    expect(closedHead.status).toBe(410);
    expect(closedHead.body).toBeNull();
    // A bearer token is not a cookie: nothing to clear.
    expect((await get({ ref: REF_CLOSED, bearer: SECRETS[3] })).headers.has("set-cookie")).toBe(false);
    await expectRefused(await get({ ref: REF_UNKNOWN, cookie: UNKNOWN }), 404);
    expect(calls.filter((c) => c.startsWith("chunk") || c.startsWith("record"))).toEqual([]);
  });

  it("answers 503 when the link or the bytes can not be read, and still serves when only the count fails", async () => {
    const bytes = synthetic(CHUNK + 1);
    const { open, get, failures } = setup(bytes);
    const secret = await open(OPEN);
    failures.resolve = true;
    const down = await get({ cookie: secret });
    expect(await expectRefused(down, 503)).toContain("try again later");
    expect(down.headers.has("set-cookie")).toBe(false);
    failures.resolve = false;

    failures.read = true;
    await expectRefused(await get({ cookie: secret }), 503);
    failures.read = false;

    failures.record = true;
    const response = await get({ cookie: secret });
    expect(response.status).toBe(200);
    expect((await response.arrayBuffer()).byteLength).toBe(bytes.length);
    expect(errors).toHaveBeenCalledWith("[install-links]", "download was not counted", { name: "Error", code: "ECONNRESET" });
  });

  it("serves each tab the link it shows, whatever other links the browser opened since", async () => {
    const bytes = synthetic(2 * CHUNK + 99);
    const { open, get, info, otherInfo } = setup(bytes);
    const secret = await open(OPEN);
    const otherSecret = await open(OTHER);
    // Both tabs' cookies in one jar; a browser sends each address only its own, but even both at once
    // pick the one named for the address.
    const jar = `${installCookieName(REF_OTHER)}=${otherSecret}; ${installCookieName(REF)}=${secret}`;
    for (const [ref, expected, version] of [
      [REF, info, "2.7.0"],
      [REF_OTHER, otherInfo, "2.7.1"],
    ] as const) {
      const head = await get({ ref, cookies: jar, method: "HEAD" });
      expect(head.headers.get("etag")).toBe(`"${expected.sha256Hex}"`);
      expect(head.headers.get("content-length")).toBe(String(expected.byteLength));
      const whole = await get({ ref, cookies: jar });
      expect(whole.headers.get("content-disposition")).toBe(`attachment; filename="Nokka-${version}.dmg"`);
      const body = new Uint8Array(await whole.arrayBuffer());
      expect(createHash("sha256").update(body).digest("hex")).toBe(expected.sha256Hex);
      const resumed = await get({ ref, cookies: jar, headers: { range: "bytes=100-", "if-range": `"${expected.sha256Hex}"` } });
      expect(resumed.status).toBe(206);
      expect(resumed.headers.get("content-range")).toBe(`bytes 100-${expected.byteLength - 1}/${expected.byteLength}`);
      await resumed.arrayBuffer();
    }
  });

  it("opens an address only with that link's session", async () => {
    const { open, get, calls } = setup(synthetic(1000));
    await open(OPEN);
    const otherSecret = await open(OTHER);
    // Another link's session, in this address's cookie or as a bearer token, opens nothing here.
    const swapped = await get({ ref: REF, cookie: otherSecret });
    await expectRefused(swapped, 404);
    expect(swapped.headers.get("set-cookie")).toBe(cleared(REF));
    await expectRefused(await get({ ref: REF_OTHER, bearer: SECRETS[0] }), 404);
    // A cookie named for another address is not read.
    await expectRefused(await get({ ref: REF, cookies: `${installCookieName(REF_OTHER)}=${otherSecret}` }), 404);
    // Anything but a ref in the path (a secret included) is refused before any lookup.
    const before = calls.length;
    for (const ref of [OPEN, SECRETS[0], "Nokka.dmg", REF.toUpperCase(), "0e4f2a8c-1b3d-1c5e-8f60-71829304a5b6"]) {
      const response = await get({ ref, bearer: SECRETS[0] });
      await expectRefused(response, 404);
      expect(response.headers.has("set-cookie")).toBe(false);
    }
    expect(calls.slice(before)).toEqual([]);
  });

  it("answers 503 without a database", async () => {
    const download = createInstallDownloadHandlers({ getLinkStore: () => null, getStore: () => null });
    await expectRefused(
      await download.GET(
        new Request(`${ORIGIN}/api/updates/v1/install/${REF}/Nokka.dmg`, { headers: { authorization: `Bearer ${SECRETS[0]}` } }),
        { params: Promise.resolve({ ref: REF }) },
      ),
      503,
    );
  });
});

describe("install link routes", () => {
  it("take the secret from no path segment: only the session and each link's download address (by ref) exist", () => {
    const base = join(process.cwd(), "src/app/api/updates/v1/install");
    expect(readdirSync(base).sort()).toEqual(["[ref]", "session"]);
    expect(readdirSync(join(base, "[ref]"))).toEqual(["Nokka.dmg"]);
    expect(readdirSync(join(base, "[ref]/Nokka.dmg"))).toEqual(["route.ts"]);
    expect(readdirSync(join(base, "session"))).toEqual(["route.ts"]);
  });
});

describe("readCookie", () => {
  it("finds the exact name and takes the first of several", () => {
    expect(readCookie(null, "a")).toBeNull();
    expect(readCookie("a=1; b=2", "b")).toBe("2");
    expect(readCookie("xa=1; a=2; a=3", "a")).toBe("2");
    expect(readCookie("a", "a")).toBeNull();
    expect(readCookie(" a = 1 ", "a")).toBe("1");
  });
});
