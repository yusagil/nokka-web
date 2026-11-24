// @vitest-environment node
// Runs against a real Postgres only when APPLICATIONS_TEST_DATABASE_URL is set (a direct, non-pooled
// test database). Everything happens in a fresh schema that is dropped afterwards; the packages are
// synthetic files of random bytes and the requests synthetic rows. Links are issued through the admin
// API handler; the session and download go over a local HTTP server (127.0.0.1) that hands requests to
// the real route handlers and records every request line, as a hosting log would. Nothing else leaves
// the process. Links open once: the tests keep, like one browser, the session cookie of each link they
// opened.
import { execFile } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { copyFile, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { applyMigrations } from "../../../../scripts/db-migrate.mjs";
import {
  CHUNK_SIZE,
  channelStatus,
  discardPackage,
  hashFile,
  initChannel,
  publishPackage,
  setInstaller,
} from "../../../../scripts/update-packages.mjs";
import { createInstallLinkHandlers as createAdminLinkHandlers } from "@/lib/admin/handlers";
import { revokeUpdatesForTest } from "@/lib/updates/registration/test-support";
import { installCookieName } from "../install-contracts";
import { createInstallDownloadHandlers, createInstallSessionHandler } from "../install-handlers";
import { createInstallLinkStore, type InstallLinkStore } from "../install-links";
import { createPackageStore, type PackageStore } from "../store";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const run = promisify(execFile);
const url = process.env.APPLICATIONS_TEST_DATABASE_URL;
const id = randomBytes(5).toString("hex");
const schema = `nokka_install_links_test_${id}`;
const BRIDGE = 24;
const TOOL = join(process.cwd(), "scripts/update-packages.mjs");
// Three chunks, the last one short.
const SIZE = 2 * CHUNK_SIZE + 4321;

describe.skipIf(!url)("private install links on Postgres", () => {
  let admin: postgres.Sql;
  let sql: postgres.Sql;
  let folder: string;
  let server: Server;
  let origin: string;
  const files: Record<number, { path: string; sha256: string }> = {};
  // What a request log would record: method, path and query string, and the referrer.
  const requestLines: string[] = [];
  const tokens: string[] = [];
  // Holds every chunk read after the first one of a response while set (see the in-flight test).
  let gate: Promise<void> | null = null;
  const chunkReads: number[] = [];

  const tool = (...args: string[]) =>
    run(process.execPath, [TOOL, ...args], {
      env: {
        ...process.env,
        DATABASE_URL: `${url}${url!.includes("?") ? "&" : "?"}options=${encodeURIComponent(`-c search_path=${schema}`)}`,
      },
    }).then(
      (done) => ({ code: 0, stdout: done.stdout, stderr: done.stderr }),
      (error) => ({ code: error.code as number, stdout: error.stdout as string, stderr: error.stderr as string }),
    );

  const stage = async (build: number) => {
    const path = join(folder, `Nokka-${build}.dmg`);
    await writeFile(path, randomBytes(SIZE));
    const { length, sha256 } = await hashFile(path);
    const manifest = {
      format: "nokka-update-package-v1",
      build,
      version: `2.7.${build - BRIDGE}`,
      minimumSystemVersion: "14.0",
      length,
      sha256,
      edSignature: `${randomBytes(64).toString("base64").slice(0, 86)}==`,
      targetCDHash: randomBytes(20).toString("hex"),
      notes: `Synthetic QA package ${build}`,
    };
    const manifestPath = join(folder, `package-${build}.json`);
    await writeFile(manifestPath, JSON.stringify(manifest));
    files[build] = { path, sha256 };
    return tool("stage", "--manifest", manifestPath, "--file", path);
  };

  const application = async (approved: boolean) => {
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO access_applications (name, email, updates_approved)
      VALUES ('QA install link', ${`nokka-install-link-qa-${id}-${randomBytes(4).toString("hex")}@example.com`}, ${approved})
      RETURNING id::text AS id
    `;
    return row.id;
  };

  const adminApi = () =>
    createAdminLinkHandlers({
      getAdminSession: async () => ({ ok: true, admin: { githubUserId: "212495406" } }),
      getAllowedOrigin: () => origin,
      getLinkStore: () => createInstallLinkStore(sql),
    });
  const adminRequest = (method: "POST" | "DELETE") =>
    new Request(`${origin}/api/admin/applications/x/install-link`, {
      method,
      headers: { origin, "content-type": "application/json", "x-admin-request": "1" },
      body: method === "POST" ? "{}" : undefined,
    });
  const issue = async (applicationId: string) => {
    const response = await adminApi().POST(adminRequest("POST"), { params: Promise.resolve({ id: applicationId }) });
    return { status: response.status, body: await response.json() };
  };
  const revoke = async (applicationId: string) => {
    const response = await adminApi().DELETE(adminRequest("DELETE"), { params: Promise.resolve({ id: applicationId }) });
    return { status: response.status, body: await response.json() };
  };
  const tokenOf = (address: string) => {
    const match = new RegExp(`^${origin}/install#([A-Za-z0-9_-]{43})$`).exec(address);
    expect(match).not.toBeNull();
    tokens.push(match![1]);
    return match![1];
  };
  const issued = async (applicationId: string) => {
    const { status, body } = await issue(applicationId);
    expect(status).toBe(201);
    return { token: tokenOf(body.link.url), link: body.link };
  };

  // What one browser holds: the session cookie (`name=secret`) of each link it opened, by the link's token.
  const browser = new Map<string, string>();
  /** What the /install page does with the fragment: one POST with the token in the body. */
  const openLink = async (token: string) => {
    const response = await fetch(`${origin}/api/updates/v1/install/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const setCookie = response.headers.get("set-cookie");
    const cookie = setCookie?.split(";")[0] ?? null;
    if (cookie) {
      tokens.push(secretOf(cookie));
      browser.set(token, cookie);
    }
    return { status: response.status, body: await response.json(), setCookie, cookie };
  };
  const secretOf = (cookie: string) => cookie.slice(cookie.indexOf("=") + 1);
  /** The session POST as it arrives, for tests that lose parts of its answer. */
  const postSession = (token: string) =>
    fetch(`${origin}/api/updates/v1/install/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
  /** What the browser does with the download link: a GET to the link's own address with the cookies it holds. */
  const fetchDownload = (
    ref: string,
    cookie: string,
    { method = "GET", headers = {} }: { method?: "GET" | "HEAD"; headers?: Record<string, string> } = {},
  ) =>
    fetch(`${origin}/api/updates/v1/install/${ref}/Nokka.dmg`, {
      method,
      headers: { cookie, "accept-encoding": "identity", ...headers },
    });
  const cookieFor = (ref: string, secret: string) => `${installCookieName(ref)}=${secret}`;
  /**
   * A download as the browser that opened the link (with the session it holds, also once the link is
   * closed); a link it never opened is opened first, and a refused opening answers instead.
   */
  const downloadWith = async (token: string, options?: Parameters<typeof fetchDownload>[2]) => {
    if (!browser.has(token)) {
      const opened = await openLink(token);
      if (opened.status !== 200) return new Response(null, { status: opened.status });
    }
    const ref: string = (await linkRow(token))?.ref ?? randomUUID();
    return fetchDownload(ref, browser.get(token)!, options);
  };
  const statusOf = async (token: string) => {
    const response = await downloadWith(token);
    await response.arrayBuffer();
    return response.status;
  };
  const linkRow = async (token: string) => {
    const [row] = await sql`
      SELECT ref::text AS ref, build, download_count, last_download_at, revoked_at, exchanged_at, session_hash,
             extract(epoch FROM expires_at - created_at)::int AS ttl
      FROM update_install_links WHERE token_hash = ${sha256(token)}
    `;
    return row;
  };

  const sha256 = (value: string) => createHash("sha256").update(value).digest();
  /**
   * Holds `token`'s link row locked from another connection, starts `requests`, waits until `waiting` of
   * them wait for that row, runs `meanwhile` in the holding transaction, commits, and returns the answers.
   */
  const whileHeld = async <T,>(
    token: string,
    waiting: number,
    requests: () => Promise<T>[],
    meanwhile?: (tx: postgres.TransactionSql) => Promise<void>,
  ): Promise<T[]> => {
    const holder = postgres(url!, { max: 1, prepare: false, onnotice: () => {}, connection: { options: `-c search_path=${schema}` } });
    let started: Promise<T>[] = [];
    try {
      await holder.begin(async (tx) => {
        await tx`SELECT 1 FROM update_install_links WHERE token_hash = ${sha256(token)} FOR UPDATE`;
        started = requests();
        for (let tries = 0; ; tries++) {
          // Waiting for the row: on this transaction, or behind the first request that waits for it.
          const [{ count }] = await admin<{ count: number }[]>`
            SELECT count(*)::int AS count FROM pg_stat_activity
            WHERE datname = current_database() AND cardinality(pg_blocking_pids(pid)) > 0
          `;
          if (count === waiting) break;
          if (tries > 400) throw new Error(`${count} of ${waiting} requests waited`);
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        await meanwhile?.(tx);
      });
    } finally {
      await holder.end();
    }
    return Promise.all(started);
  };
  // The session endpoint against `links`, called directly (for failures the HTTP server's store never has).
  const sessionWith = (links: InstallLinkStore, newSessionSecret?: () => string) => (token: string) =>
    createInstallSessionHandler({ getLinkStore: () => links, newSessionSecret })(
      new Request(`${origin}/api/updates/v1/install/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      }),
    );

  beforeAll(async () => {
    admin = postgres(url!, { max: 1, onnotice: () => {} });
    await admin`CREATE SCHEMA ${admin(schema)}`;
    sql = postgres(url!, { max: 8, prepare: false, onnotice: () => {}, connection: { options: `-c search_path=${schema}` } });
    const [{ current }] = await sql`SELECT current_schema() AS current`;
    if (current !== schema) throw new Error(`Test connection is not isolated (schema: ${current})`);
    expect((await applyMigrations(sql)).at(-1)).toBe("0008_install_link_single_use.sql");
    folder = await mkdtemp(join(tmpdir(), "nokka-install-links-"));

    const packages = createPackageStore(sql);
    const gated: PackageStore = {
      ...packages,
      async readChunk(build, index, offset, length) {
        if (gate && index > 0) await gate;
        chunkReads.push(index);
        return packages.readChunk(build, index, offset, length);
      },
    };
    const deps = { getLinkStore: () => createInstallLinkStore(sql), getStore: () => gated };
    const session = createInstallSessionHandler(deps);
    const download = createInstallDownloadHandlers(deps);
    server = createServer(async (req, res) => {
      requestLines.push(`${req.method} ${req.url} referer=${req.headers.referer ?? ""}`);
      const address = `${origin}${req.url}`;
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) {
        if (typeof value === "string") headers.set(name, value);
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const method = req.method ?? "GET";
      const request = new Request(address, {
        method,
        headers,
        body: method === "POST" ? Buffer.concat(chunks) : undefined,
      });
      const path = new URL(address).pathname;
      const file = /^\/api\/updates\/v1\/install\/([^/]+)\/Nokka\.dmg$/.exec(path);
      const response =
        path === "/api/updates/v1/install/session" && method === "POST"
          ? await session(request)
          : file && (method === "GET" || method === "HEAD")
            ? await download[method](request, { params: Promise.resolve({ ref: file[1] }) })
            : new Response("not found", { status: 404 });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (!response.body) return void res.end();
      await pipeline(Readable.fromWeb(response.body as import("node:stream/web").ReadableStream), res).catch(() => {});
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const bound = server.address();
    origin = `http://127.0.0.1:${typeof bound === "object" && bound ? bound.port : 0}`;
  });

  afterAll(async () => {
    server?.close();
    await sql?.end();
    if (admin) {
      await admin`DROP SCHEMA IF EXISTS ${admin(schema)} CASCADE`;
      await admin.end();
    }
    if (folder) await rm(folder, { recursive: true, force: true });
  });

  it("enables row level security and keeps one open link per request", async () => {
    const [table] = await sql`
      SELECT relrowsecurity FROM pg_class WHERE relnamespace = ${schema}::regnamespace AND relname = 'update_install_links'
    `;
    expect(table.relrowsecurity).toBe(true);
    const [{ count }] = await sql`
      SELECT count(*)::int AS count FROM pg_indexes
      WHERE schemaname = ${schema} AND indexname = 'update_install_links_one_open_idx'
    `;
    expect(count).toBe(1);
  });

  it("issues nothing until a servable installer is set, and only for an allowed request", async () => {
    const allowed = await application(true);
    const notAllowed = await application(false);
    expect(await issue(allowed)).toEqual({ status: 409, body: { ok: false, code: "NO_INSTALLER" } });
    await initChannel(sql, BRIDGE);
    expect(await issue(allowed)).toEqual({ status: 409, body: { ok: false, code: "NO_INSTALLER" } });
    expect(await issue(notAllowed)).toEqual({ status: 409, body: { ok: false, code: "UPDATES_NOT_APPROVED" } });
    expect(await issue("999999999")).toEqual({ status: 404, body: { ok: false, code: "NOT_FOUND" } });

    // The bridge build can be stored (never published); a build below it can not.
    expect(await stage(BRIDGE - 1)).toMatchObject({ code: 1 });
    expect(await stage(BRIDGE)).toMatchObject({ code: 0 });
    expect(await stage(BRIDGE + 1)).toMatchObject({ code: 0 });
    await expect(publishPackage(sql, BRIDGE, null)).rejects.toThrow(/not above build 24/);
    expect(await createPackageStore(sql).publishedPackage(BRIDGE)).toBeNull();

    await expect(setInstaller(sql, BRIDGE + 1)).rejects.toThrow(/neither the bridge build 24 nor published/);
    await expect(setInstaller(sql, 99)).rejects.toThrow(/no package for build 99/);
    expect(await tool("installer", "--build", "x")).toMatchObject({ code: 2 });
    const set = await tool("installer", "--build", String(BRIDGE));
    expect(set).toMatchObject({ code: 0 });
    expect(set.stdout).toContain("New install links serve build 24 (was no build).");
    expect((await tool("installer", "--build", String(BRIDGE))).stdout).toContain("already serve build 24");
    expect((await channelStatus(sql)).channel).toMatchObject({ bridgeBuild: BRIDGE, currentBuild: null, installerBuild: BRIDGE });
    const [event] = await sql`SELECT action, build, previous_build FROM update_channel_events ORDER BY id DESC LIMIT 1`;
    expect(event).toEqual({ action: "installer", build: BRIDGE, previous_build: null });
  });

  it("opens a link once with the token in a body, then downloads with the session cookie, whole and resumed", async () => {
    const allowed = await application(true);
    const { token, link } = await issued(allowed);
    expect(link).toMatchObject({ build: BRIDGE, version: "2.7.0" });
    const row = await linkRow(token);
    expect(row).toMatchObject({
      build: BRIDGE,
      download_count: 0,
      last_download_at: null,
      revoked_at: null,
      exchanged_at: null,
      session_hash: null,
    });
    expect(row.ttl).toBe(72 * 60 * 60);
    expect(Date.parse(link.expiresAt) - Date.now()).toBeGreaterThan(71 * 3600 * 1000);

    const opened = await openLink(token);
    expect(opened.status).toBe(200);
    const ref = row.ref;
    expect(opened.body).toEqual({ ok: true, ref, version: "2.7.0", build: BRIDGE, byteLength: SIZE, expiresAt: link.expiresAt });
    const [pair, maxAge, ...attributes] = opened.setCookie!.split("; ");
    // A session secret of its own, never the link's token; only its hash is stored, and the token is used.
    const secret = secretOf(pair);
    expect(pair).toMatch(new RegExp(`^${installCookieName(ref)}=[A-Za-z0-9_-]{43}$`));
    expect(secret).not.toBe(token);
    const exchanged = await linkRow(token);
    expect(exchanged.exchanged_at).not.toBeNull();
    expect(Buffer.from(exchanged.session_hash).equals(sha256(secret))).toBe(true);
    expect(attributes).toEqual([`Path=/api/updates/v1/install/${ref}`, "HttpOnly", "Secure", "SameSite=Strict"]);
    // The link's remaining lifetime (this process's clock against the database's).
    const seconds = Number(maxAge.replace(/^Max-Age=/, ""));
    expect(seconds).toBeGreaterThan(72 * 3600 - 60);
    expect(seconds).toBeLessThanOrEqual(72 * 3600);
    const cookie = opened.cookie!;

    const head = await fetchDownload(ref, cookie, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe(String(SIZE));
    const etag = head.headers.get("etag")!;

    const whole = await fetchDownload(ref, cookie);
    expect(whole.status).toBe(200);
    expect(whole.headers.get("content-disposition")).toBe('attachment; filename="Nokka-2.7.0.dmg"');
    const bytes = Buffer.from(await whole.arrayBuffer());
    expect(bytes.length).toBe(SIZE);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(files[BRIDGE].sha256);

    // A browser resuming a cut download: an open range checked against the ETag, with the same cookie.
    const from = CHUNK_SIZE - 7;
    const part = await fetchDownload(ref, cookie, { headers: { range: `bytes=${from}-`, "if-range": etag } });
    expect(part.status).toBe(206);
    expect(Buffer.concat([bytes.subarray(0, from), Buffer.from(await part.arrayBuffer())]).equals(bytes)).toBe(true);
    // Tools can send the session secret as a bearer token instead; the link's token is no session.
    const bearer = (value: string) =>
      fetch(`${origin}/api/updates/v1/install/${ref}/Nokka.dmg`, { headers: { authorization: `Bearer ${value}` } });
    expect(Buffer.from(await (await bearer(secret)).arrayBuffer()).equals(bytes)).toBe(true);
    const byToken = await bearer(token);
    expect(byToken.status).toBe(404);
    await byToken.arrayBuffer();
    expect((await fetchDownload(ref, cookieFor(ref, token))).status).toBe(404);

    // The token opens nothing any more (no session, no cookie, only what the first answer named); this
    // browser's session keeps working.
    const again = await openLink(token);
    expect(again).toMatchObject({ status: 410, setCookie: null });
    expect(again.body).toEqual({ ...opened.body, ok: false, code: "USED" });
    expect((await fetchDownload(ref, cookie, { method: "HEAD" })).status).toBe(200);
    expect(Buffer.from((await linkRow(token)).session_hash).equals(sha256(secret))).toBe(true);

    const counted = await linkRow(token);
    expect(counted.download_count).toBe(3);
    expect(counted.last_download_at).not.toBeNull();
    expect(await statusOf("Z".repeat(42) + "A")).toBe(404);
    expect((await openLink("Z".repeat(42) + "A")).status).toBe(404);
  });

  it("opens a token exactly once when it is sent many times at once", async () => {
    const allowed = await application(true);
    const { token } = await issued(allowed);
    // All attempts start while the link row is held, and go on together once it is released.
    const attempts = await whileHeld(token, 8, () => Array.from({ length: 8 }, () => openLink(token)));
    const opened = attempts.filter((attempt) => attempt.status === 200);
    expect(opened).toHaveLength(1);
    // The other tabs of the same browser are refused but told the link, and find the winner's download.
    for (const attempt of attempts.filter((a) => a.status !== 200)) {
      expect(attempt).toMatchObject({ status: 410, setCookie: null });
      expect(attempt.body).toEqual({ ...opened[0].body, ok: false, code: "USED" });
      expect((await fetchDownload(attempt.body.ref, opened[0].cookie!, { method: "HEAD" })).status).toBe(200);
    }
    // The one stored session is the winner's, and it downloads.
    const row = await linkRow(token);
    expect(Buffer.from(row.session_hash).equals(sha256(secretOf(opened[0].cookie!)))).toBe(true);
    const whole = await fetchDownload(row.ref, opened[0].cookie!);
    expect(createHash("sha256").update(Buffer.from(await whole.arrayBuffer())).digest("hex")).toBe(files[BRIDGE].sha256);
  });

  it("does not open a link that was closed while the opening waited for it", async () => {
    const allowed = await application(true);
    const { token } = await issued(allowed);
    // Revocation, replacement and approval withdrawal all close the link row like this.
    const [opening] = await whileHeld(token, 1, () => [openLink(token)], async (tx) => {
      await tx`UPDATE update_install_links SET revoked_at = now() WHERE token_hash = ${sha256(token)}`;
    });
    expect(opening).toMatchObject({ status: 410, body: { ok: false, code: "GONE" }, setCookie: null });
    expect(await linkRow(token)).toMatchObject({ exchanged_at: null, session_hash: null });

    // Opened first: a revocation then closes its session, and the token stays closed.
    const second = await issued(allowed);
    const { cookie, body } = await openLink(second.token);
    expect(await revoke(allowed)).toEqual({ status: 200, body: { ok: true, revoked: 1 } });
    const resume = await fetchDownload(body.ref, cookie!, { headers: { range: "bytes=10-" } });
    expect(resume.status).toBe(410);
    await resume.arrayBuffer();
    expect((await openLink(second.token)).body).toEqual({ ok: false, code: "GONE" });
  });

  // An opening that waits for the link row is judged by the time and state when it gets the row.
  it("does not open a link that expired while the opening waited for it", async () => {
    const expiring = await issued(await application(true));
    await sql`UPDATE update_install_links SET expires_at = now() + interval '2 seconds' WHERE token_hash = ${sha256(expiring.token)}`;
    const [late] = await whileHeld(expiring.token, 1, () => [openLink(expiring.token)], async (tx) => {
      await tx`
        SELECT pg_sleep(extract(epoch FROM expires_at - clock_timestamp())::float8 + 0.2)
        FROM update_install_links WHERE token_hash = ${sha256(expiring.token)}
      `;
    });
    expect(late).toMatchObject({ status: 410, body: { ok: false, code: "GONE" }, setCookie: null });
    expect(await linkRow(expiring.token)).toMatchObject({ exchanged_at: null, session_hash: null });
  });

  it("sets the cookie for what is left once the opening got the link row, not from when it began", async () => {
    const waiting = await issued(await application(true));
    await sql`UPDATE update_install_links SET expires_at = now() + interval '10 seconds' WHERE token_hash = ${sha256(waiting.token)}`;
    const [opened] = await whileHeld(waiting.token, 1, () => [openLink(waiting.token)], async (tx) => {
      await tx`SELECT pg_sleep(4)`;
    });
    expect(opened.status).toBe(200);
    const maxAge = Number(/Max-Age=(\d+)/.exec(opened.setCookie!)![1]);
    expect(maxAge).toBeGreaterThanOrEqual(1);
    expect(maxAge).toBeLessThanOrEqual(6);
  });

  it("does not open a link whose approval was withdrawn while the opening waited for it", async () => {
    // Withdrawn without touching the link row (the request row changes first in a real withdrawal).
    const approval = await application(true);
    const withdrawn = await issued(approval);
    const [refused] = await whileHeld(withdrawn.token, 1, () => [openLink(withdrawn.token)], async (tx) => {
      await tx`UPDATE access_applications SET updates_approved = false WHERE id = ${approval}::bigint`;
    });
    expect(refused).toMatchObject({ status: 410, body: { ok: false, code: "GONE" }, setCookie: null });
    expect(await linkRow(withdrawn.token)).toMatchObject({ exchanged_at: null, session_hash: null });
  });

  it("finds the download again in the browser holding the session when the first answer's body was lost", async () => {
    const allowed = await application(true);
    const { token, link } = await issued(allowed);
    // The first answer's headers arrive (the browser keeps the cookie), its body never does.
    const first = await postSession(token);
    expect(first.status).toBe(200);
    const cookie = first.headers.get("set-cookie")!.split(";")[0];
    tokens.push(secretOf(cookie));
    await first.body?.cancel();
    const before = await linkRow(token);

    // The page's retry is refused but names the link; its HEAD with this browser's cookie finds the download.
    const retry = await postSession(token);
    expect(retry.status).toBe(410);
    expect(retry.headers.has("set-cookie")).toBe(false);
    const named = await retry.json();
    expect(named).toEqual({
      ok: false,
      code: "USED",
      ref: before.ref,
      version: link.version,
      build: link.build,
      byteLength: SIZE,
      expiresAt: link.expiresAt,
    });
    for (const secret of [token, secretOf(cookie)]) expect(JSON.stringify(named)).not.toContain(secret);
    const head = await fetchDownload(named.ref, cookie, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe(String(named.byteLength));
    const etag = head.headers.get("etag")!;
    const whole = Buffer.from(await (await fetchDownload(named.ref, cookie)).arrayBuffer());
    expect(createHash("sha256").update(whole).digest("hex")).toBe(files[BRIDGE].sha256);
    const resumed = await fetchDownload(named.ref, cookie, { headers: { range: "bytes=4321-", "if-range": etag } });
    expect(resumed.status).toBe(206);
    expect(Buffer.from(await resumed.arrayBuffer()).equals(whole.subarray(4321))).toBe(true);

    // The retry made no session and moved nothing; HEAD counted no download.
    const after = await linkRow(token);
    expect(Buffer.from(after.session_hash).equals(Buffer.from(before.session_hash))).toBe(true);
    expect(after.exchanged_at).toEqual(before.exchanged_at);
    expect(after.download_count).toBe(2);
  });

  it("keeps a lost cookie lost: without the session the HEAD is 404 and only a new link opens", async () => {
    const allowed = await application(true);
    const { token } = await issued(allowed);
    // The first answer is lost whole, headers included: no browser holds its session.
    const lost = await postSession(token);
    expect(lost.status).toBe(200);
    tokens.push(secretOf(lost.headers.get("set-cookie")!.split(";")[0]));
    await lost.body?.cancel();
    const before = await linkRow(token);

    const other = await openLink((await issued(await application(true))).token);
    for (let attempt = 0; attempt < 3; attempt++) {
      const retry = await postSession(token);
      expect(retry.status).toBe(410);
      expect(retry.headers.has("set-cookie")).toBe(false);
      const { ref, code } = await retry.json();
      expect([ref, code]).toEqual([before.ref, "USED"]);
      // No cookie, another link's session, or the link's own token under this address's cookie: 404.
      for (const cookie of ["", cookieFor(ref, secretOf(other.cookie!)), cookieFor(ref, token)]) {
        const head = await fetchDownload(ref, cookie, { method: "HEAD" });
        expect(head.status).toBe(404);
      }
    }
    // The token never made a second session.
    expect(Buffer.from((await linkRow(token)).session_hash).equals(Buffer.from(before.session_hash))).toBe(true);

    // A new link replaces it: that one opens, and the old one now answers a plain GONE.
    const replacement = await issued(allowed);
    expect(await statusOf(replacement.token)).toBe(200);
    expect(await (await postSession(token)).json()).toEqual({ ok: false, code: "GONE" });
  });

  it("leaves the token unused when an opening fails, so a retry opens it", async () => {
    const allowed = await application(true);
    const { token } = await issued(allowed);
    const links = createInstallLinkStore(sql);
    // The database is unreachable: nothing happens.
    const down = sessionWith({ ...links, exchange: async () => Promise.reject(Object.assign(new Error("down"), { code: "ECONNRESET" })) });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect((await down(token)).status).toBe(503);
      // The exchange fails after the link row is locked and checked (another link already has this
      // session secret): the transaction rolls back and the token stays unused.
      const other = await issued(await application(true));
      const taken = (await openLink(other.token)).cookie!;
      const collides = await sessionWith(links, () => secretOf(taken))(token);
      expect(collides.status).toBe(503);
      expect(collides.headers.has("set-cookie")).toBe(false);
      expect(JSON.stringify(errors.mock.calls)).not.toContain(token);
    } finally {
      errors.mockRestore();
    }
    expect(await linkRow(token)).toMatchObject({ exchanged_at: null, session_hash: null });

    const retried = await openLink(token);
    expect(retried.status).toBe(200);
    expect(await statusOf(token)).toBe(200);
    expect((await openLink(token)).body).toEqual({ ...retried.body, ok: false, code: "USED" });
  });

  it("resumes with the session cookie until the link expires, and opens nothing with less than a second left", async () => {
    const allowed = await application(true);
    const { token } = await issued(allowed);
    const { cookie, body } = await openLink(token);
    const ref: string = body.ref;
    const etag = (await fetchDownload(ref, cookie!, { method: "HEAD" })).headers.get("etag")!;
    // A download cut several times, each resumed from where it stopped, with the same cookie.
    const parts: Buffer[] = [];
    for (const [from, to] of [
      [0, 999],
      [1000, CHUNK_SIZE + 10],
      [CHUNK_SIZE + 11, null],
    ] as const) {
      const part = await fetchDownload(ref, cookie!, { headers: { range: `bytes=${from}-${to ?? ""}`, "if-range": etag } });
      expect(part.status).toBe(206);
      parts.push(Buffer.from(await part.arrayBuffer()));
    }
    expect(createHash("sha256").update(Buffer.concat(parts)).digest("hex")).toBe(files[BRIDGE].sha256);
    expect((await linkRow(token)).download_count).toBe(3);

    await sql`
      UPDATE update_install_links SET created_at = now() - interval '73 hours', expires_at = now() - interval '1 second'
      WHERE token_hash = ${sha256(token)}
    `;
    const resume = await fetchDownload(ref, cookie!, { headers: { range: "bytes=10-", "if-range": etag } });
    expect(resume.status).toBe(410);
    expect(resume.headers.get("set-cookie")).toBe(
      `${installCookieName(ref)}=; Max-Age=0; Path=/api/updates/v1/install/${ref}; HttpOnly; Secure; SameSite=Strict`,
    );
    await resume.arrayBuffer();
    // Closed comes before used.
    expect((await openLink(token)).body).toEqual({ ok: false, code: "GONE" });

    // Open by the database's clock, but under a second left: no cookie, and the token stays unused.
    const late = await issued(await application(true));
    await sql`UPDATE update_install_links SET expires_at = now() + interval '500 milliseconds' WHERE token_hash = ${sha256(late.token)}`;
    expect(await openLink(late.token)).toMatchObject({ status: 410, body: { ok: false, code: "GONE" }, setCookie: null });
    expect(await linkRow(late.token)).toMatchObject({ exchanged_at: null, session_hash: null });
  });

  it("lets a response already sending bytes finish after revocation, and refuses every new request", async () => {
    const allowed = await application(true);
    const { token } = await issued(allowed);
    const { cookie, body: opened } = await openLink(token);
    const ref: string = opened.ref;
    chunkReads.length = 0;
    let release!: () => void;
    gate = new Promise<void>((resolve) => (release = resolve));
    try {
      const response = await fetchDownload(ref, cookie!);
      expect(response.status).toBe(200);
      const reader = response.body!.getReader();
      const received: Uint8Array[] = [];
      let length = 0;
      // The first chunk arrives; the next read waits at the gate.
      while (length < CHUNK_SIZE) {
        const { value, done } = await reader.read();
        if (done) throw new Error("ended early");
        received.push(value);
        length += value.length;
      }
      expect(chunkReads.filter((index) => index > 0)).toEqual([]);

      expect(await revoke(allowed)).toEqual({ status: 200, body: { ok: true, revoked: 1 } });
      // Every new request is refused, the resume of this very download included, and the cookie cleared.
      const resume = await fetchDownload(ref, cookie!, { headers: { range: `bytes=${length}-` } });
      expect(resume.status).toBe(410);
      expect(resume.headers.get("set-cookie")).toBe(
        `${installCookieName(ref)}=; Max-Age=0; Path=/api/updates/v1/install/${ref}; HttpOnly; Secure; SameSite=Strict`,
      );
      expect(Buffer.from(await resume.arrayBuffer()).toString("utf8")).toContain("This install link can't be used");
      expect((await openLink(token)).status).toBe(410);
      expect(await statusOf(token)).toBe(410);
      const readsAtRevocation = chunkReads.length;

      // The response that was already sending is not cut off: its later chunks are read after the revocation.
      release();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        received.push(value);
      }
      const bytes = Buffer.concat(received);
      expect(bytes.length).toBe(SIZE);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(files[BRIDGE].sha256);
      expect(chunkReads.slice(readsAtRevocation)).toEqual([1, 2]);
    } finally {
      gate = null;
      release();
    }
  });

  it("closes a link when it is replaced, revoked or expired", async () => {
    const allowed = await application(true);
    const first = await issued(allowed);
    const second = await issued(allowed);
    expect(await statusOf(first.token)).toBe(410);
    expect(await statusOf(second.token)).toBe(200);
    const [{ open }] = await sql`
      SELECT count(*)::int AS open FROM update_install_links WHERE application_id = ${allowed}::bigint AND revoked_at IS NULL
    `;
    expect(open).toBe(1);

    expect(await revoke(allowed)).toEqual({ status: 200, body: { ok: true, revoked: 1 } });
    expect(await statusOf(second.token)).toBe(410);
    expect(await revoke(allowed)).toEqual({ status: 200, body: { ok: true, revoked: 0 } });
    expect(await revoke("999999999")).toEqual({ status: 404, body: { ok: false, code: "NOT_FOUND" } });

    const third = await issued(allowed);
    expect(await statusOf(third.token)).toBe(200);
    await sql`
      UPDATE update_install_links SET created_at = now() - interval '73 hours', expires_at = now() - interval '1 hour'
      WHERE token_hash = ${createHash("sha256").update(third.token).digest()}
    `;
    expect(await statusOf(third.token)).toBe(410);
    expect((await downloadWith(third.token, { method: "HEAD" })).status).toBe(410);
    expect((await openLink(third.token)).status).toBe(410);
    // An expired link is not counted as revoked, but a new one still replaces it.
    expect(await revoke(allowed)).toEqual({ status: 200, body: { ok: true, revoked: 0 } });
  });

  it("issues one open link when two are requested at once", async () => {
    const allowed = await application(true);
    const results = await Promise.all([issue(allowed), issue(allowed), issue(allowed)]);
    expect(results.map((result) => result.status)).toEqual([201, 201, 201]);
    const statuses = await Promise.all(results.map(({ body }) => statusOf(tokenOf(body.link.url))));
    expect(statuses.sort()).toEqual([200, 410, 410]);
  });

  it("closes the link for good when the approval is withdrawn", async () => {
    const allowed = await application(true);
    const { token } = await issued(allowed);
    expect(await statusOf(token)).toBe(200);
    await revokeUpdatesForTest(sql, allowed);
    expect(await statusOf(token)).toBe(410);
    expect((await linkRow(token)).revoked_at).not.toBeNull();
    expect(await issue(allowed)).toEqual({ status: 409, body: { ok: false, code: "UPDATES_NOT_APPROVED" } });

    await sql`UPDATE access_applications SET updates_approved = true WHERE id = ${allowed}::bigint`;
    expect(await statusOf(token)).toBe(410);
    expect(await statusOf((await issued(allowed)).token)).toBe(200);
  });

  it("serves a published installer, and closes its links when it is rolled back or withdrawn", async () => {
    const allowed = await application(true);
    const bridgeLink = await issued(allowed);

    // A linked or installer package is never discarded.
    await expect(discardPackage(sql, BRIDGE)).rejects.toThrow(/is the installer/);
    await setInstaller(sql, null);
    expect(await issue(allowed)).toEqual({ status: 409, body: { ok: false, code: "NO_INSTALLER" } });
    const tab24 = await openLink(bridgeLink.token);
    expect(await statusOf(bridgeLink.token)).toBe(200);
    await expect(discardPackage(sql, BRIDGE)).rejects.toThrow(/handed out by install links/);

    // A published build as the installer; links issued before keep their build.
    expect(await tool("publish", "--build", String(BRIDGE + 1), "--expect-current", "none")).toMatchObject({ code: 0 });
    expect(await tool("installer", "--build", String(BRIDGE + 1))).toMatchObject({ code: 0 });
    const other = await application(true);
    const newer = await issued(other);
    expect(newer.link).toMatchObject({ build: BRIDGE + 1, version: "2.7.1" });

    // Two tabs in one browser: build 24's link, then build 25's. One cookie jar holds both, and each
    // tab's download, HEAD and resume get the build that tab shows.
    const tab25 = await openLink(newer.token);
    expect([tab24.body.build, tab25.body.build]).toEqual([BRIDGE, BRIDGE + 1]);
    expect(tab24.body.ref).not.toBe(tab25.body.ref);
    const jar = `${tab25.cookie}; ${tab24.cookie}`;
    for (const [tab, build] of [
      [tab24, BRIDGE],
      [tab25, BRIDGE + 1],
    ] as const) {
      const head = await fetchDownload(tab.body.ref, jar, { method: "HEAD" });
      const etag = head.headers.get("etag")!;
      expect(etag).toBe(`"${files[build].sha256}"`);
      const whole = Buffer.from(await (await fetchDownload(tab.body.ref, jar)).arrayBuffer());
      expect(createHash("sha256").update(whole).digest("hex")).toBe(files[build].sha256);
      const resumed = await fetchDownload(tab.body.ref, jar, { headers: { range: "bytes=1000-", "if-range": etag } });
      expect(resumed.status).toBe(206);
      expect(Buffer.from(await resumed.arrayBuffer()).equals(whole.subarray(1000))).toBe(true);
      // The other tab's session, or either link's token, does not open this tab's address.
      for (const swapped of [secretOf((tab === tab24 ? tab25 : tab24).cookie!), newer.token, bridgeLink.token]) {
        expect((await fetchDownload(tab.body.ref, cookieFor(tab.body.ref, swapped))).status).toBe(404);
      }
    }

    const published = await issued(allowed);
    expect(published.link).toMatchObject({ build: BRIDGE + 1, version: "2.7.1" });
    const bytes = Buffer.from(await (await downloadWith(published.token)).arrayBuffer());
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(files[BRIDGE + 1].sha256);

    const rolledBack = await tool("rollback", "--to", "none", "--expect-current", String(BRIDGE + 1));
    expect(rolledBack).toMatchObject({ code: 0 });
    expect(rolledBack.stdout).toContain("It was the installer");
    expect(await statusOf(published.token)).toBe(410);
    expect((await channelStatus(sql)).channel).toMatchObject({ currentBuild: null, installerBuild: null });
    await expect(setInstaller(sql, BRIDGE + 1)).rejects.toThrow(/withdrawn/);

    // The bridge build again, then withdrawn: its links close and new ones stop.
    await setInstaller(sql, BRIDGE);
    const last = await issued(allowed);
    expect(await statusOf(last.token)).toBe(200);
    const withdrawn = await tool("withdraw", "--build", String(BRIDGE));
    expect(withdrawn).toMatchObject({ code: 0 });
    expect(withdrawn.stdout).toContain("It was the installer");
    expect(await statusOf(last.token)).toBe(410);
    expect(await issue(allowed)).toEqual({ status: 409, body: { ok: false, code: "NO_INSTALLER" } });
    const events = await sql`SELECT action, build, previous_build FROM update_channel_events WHERE action = 'installer' ORDER BY id`;
    expect(events.map((e) => [e.build, e.previous_build])).toEqual([
      [BRIDGE, null],
      [null, BRIDGE],
      [BRIDGE + 1, null],
      [null, BRIDGE + 1],
      [BRIDGE, null],
      [null, BRIDGE],
    ]);
  });

  it("migrates links issued before they opened once: each opens once more, and their old cookies open nothing", async () => {
    const legacySchema = `${schema}_legacy`;
    await admin`CREATE SCHEMA ${admin(legacySchema)}`;
    const legacy = postgres(url!, {
      max: 4,
      prepare: false,
      onnotice: () => {},
      connection: { options: `-c search_path=${legacySchema}` },
    });
    const upTo0007 = await mkdtemp(join(tmpdir(), "nokka-migrations-0007-"));
    try {
      const all = join(process.cwd(), "db/migrations");
      for (const name of (await readdir(all)).filter((file) => file.endsWith(".sql") && file < "0008")) {
        await copyFile(join(all, name), join(upTo0007, name));
      }
      expect((await applyMigrations(legacy, upTo0007)).at(-1)).toBe("0007_update_install_links.sql");
      // A verified one-chunk package and an allowed request as rows, and two links as the earlier code left
      // them: one open that a browser already opened and downloaded through (its cookie held the token
      // itself), one revoked.
      const bytes = randomBytes(1000);
      await legacy`
        INSERT INTO update_packages (build, short_version, minimum_system_version, byte_length, sha256, ed_signature,
                                     target_cdhash, chunk_size, chunk_count)
        VALUES (${BRIDGE}, '2.7.0', '14.0', ${bytes.length}, ${createHash("sha256").update(bytes).digest()},
                ${`${"A".repeat(86)}==`}, ${"0".repeat(40)}, ${CHUNK_SIZE}, 1)
      `;
      await legacy`INSERT INTO update_package_chunks (build, chunk_index, data) VALUES (${BRIDGE}, 0, ${bytes})`;
      await legacy`UPDATE update_packages SET verified_at = now() WHERE build = ${BRIDGE}`;
      const [{ id: applicationId }] = await legacy<{ id: string }[]>`
        INSERT INTO access_applications (name, email, updates_approved)
        VALUES ('QA install link', ${`nokka-install-link-qa-${id}-legacy@example.com`}, true)
        RETURNING id::text AS id
      `;
      const open = randomBytes(32).toString("base64url");
      const revoked = randomBytes(32).toString("base64url");
      const ref = randomUUID();
      await legacy`
        INSERT INTO update_install_links (token_hash, ref, application_id, build, expires_at, download_count, last_download_at)
        VALUES (${sha256(open)}, ${ref}::uuid, ${applicationId}::bigint, ${BRIDGE}, now() + interval '72 hours', 1, now())
      `;
      await legacy`
        INSERT INTO update_install_links (token_hash, ref, application_id, build, expires_at, revoked_at)
        VALUES (${sha256(revoked)}, ${randomUUID()}::uuid, ${applicationId}::bigint, ${BRIDGE}, now() + interval '72 hours', now())
      `;

      expect(await applyMigrations(legacy)).toEqual(["0008_install_link_single_use.sql"]);
      const rows = await legacy`SELECT exchanged_at, session_hash FROM update_install_links`;
      expect(rows).toEqual([
        { exchanged_at: null, session_hash: null },
        { exchanged_at: null, session_hash: null },
      ]);

      const links = createInstallLinkStore(legacy);
      const download = createInstallDownloadHandlers({ getLinkStore: () => links, getStore: () => createPackageStore(legacy) });
      const get = (secret: string) =>
        download.GET(
          new Request(`${origin}/api/updates/v1/install/${ref}/Nokka.dmg`, { headers: { cookie: cookieFor(ref, secret) } }),
          { params: Promise.resolve({ ref }) },
        );
      // The cookie set before the migration is refused and cleared; opening the link again works once.
      const old = await get(open);
      expect(old.status).toBe(404);
      expect(old.headers.get("set-cookie")).toContain("Max-Age=0");
      await old.arrayBuffer();
      const session = sessionWith(links);
      const opened = await session(open);
      expect(opened.status).toBe(200);
      const secret = secretOf(opened.headers.get("set-cookie")!.split(";")[0]);
      const whole = await get(secret);
      expect(whole.status).toBe(200);
      expect(Buffer.from(await whole.arrayBuffer()).equals(bytes)).toBe(true);
      expect(await (await session(open)).json()).toMatchObject({ ok: false, code: "USED", ref });
      expect(await (await session(revoked)).json()).toEqual({ ok: false, code: "GONE" });
      const [counted] = await legacy`SELECT download_count FROM update_install_links WHERE ref = ${ref}::uuid`;
      expect(counted.download_count).toBe(2);
    } finally {
      await legacy.end();
      await admin`DROP SCHEMA IF EXISTS ${admin(legacySchema)} CASCADE`;
      await rm(upTo0007, { recursive: true, force: true });
    }
  });

  it("never had a link's secret in a request line or a referrer", () => {
    expect(tokens.length).toBeGreaterThan(10);
    expect(requestLines.length).toBeGreaterThan(20);
    for (const line of requestLines) {
      // Paths name a link's ref at most, never its secret.
      expect(line).toMatch(
        /^(POST \/api\/updates\/v1\/install\/session|(GET|HEAD) \/api\/updates\/v1\/install\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/Nokka\.dmg) referer=$/,
      );
      for (const token of tokens) expect(line).not.toContain(token);
    }
  });
});
