// @vitest-environment node
// Runs against a real Postgres only when APPLICATIONS_TEST_DATABASE_URL is set (a direct, non-pooled
// test database). Everything happens in a fresh schema that is dropped afterwards; the packages are
// synthetic files of random bytes and the registrations synthetic rows. Downloads go over a local HTTP
// server (127.0.0.1) that hands requests to the real route handlers; nothing else leaves the process.
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { applyMigrations } from "../../../../scripts/db-migrate.mjs";
import { checkEndpoints } from "../../../../scripts/check-update-endpoints.mjs";
import {
  CHUNK_SIZE,
  channelStatus,
  discardPackage,
  hashFile,
  initChannel,
  publishPackage,
  rollbackChannel,
  stagePackage,
  verifyPackage,
  withdrawPackage,
} from "../../../../scripts/update-packages.mjs";
import { createUpdateAuthorizer } from "@/lib/updates/registration/authorize";
import { revokeUpdatesForTest, seedRegisteredSession } from "@/lib/updates/registration/test-support";
import { createAppcastHandlers, createPackageHandlers } from "../handlers";
import { createPackageStore, type PackageStore } from "../store";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

const run = promisify(execFile);
const url = process.env.APPLICATIONS_TEST_DATABASE_URL;
const id = randomBytes(5).toString("hex");
const schema = `nokka_packages_test_${id}`;
const BRIDGE = 23;
// The public 2.6.2 DMG is 31,783,744 bytes; the synthetic package is a little larger and not a whole
// number of chunks.
const LARGE = 31_783_744 + 777;
const TOOL = join(process.cwd(), "scripts/update-packages.mjs");
const CHECKER = join(process.cwd(), "scripts/check-update-endpoints.mjs");

type Manifest = {
  format: string;
  build: number;
  version: string;
  minimumSystemVersion: string;
  length: number;
  sha256: string;
  edSignature: string;
  targetCDHash: string;
  notes: string;
};

describe.skipIf(!url)("protected update packages on Postgres", () => {
  let admin: postgres.Sql;
  let sql: postgres.Sql;
  let folder: string;
  let server: Server;
  let origin: string;
  const reads = { count: 0, bytes: 0, largest: 0 };

  const writePackage = async (name: string, size: number) => {
    const path = join(folder, name);
    const out = createWriteStream(path);
    for (let left = size; left > 0; left -= 1 << 20) {
      if (!out.write(randomBytes(Math.min(left, 1 << 20)))) await once(out, "drain");
    }
    out.end();
    await once(out, "finish");
    return path;
  };
  const manifestFor = async (path: string, build: number, version = "2.7.0"): Promise<Manifest> => {
    const { length, sha256 } = await hashFile(path);
    return {
      format: "nokka-update-package-v1",
      build,
      version,
      minimumSystemVersion: "14.0",
      length,
      sha256,
      edSignature: `${randomBytes(64).toString("base64").slice(0, 86)}==`,
      targetCDHash: randomBytes(20).toString("hex"),
      notes: `Synthetic QA package ${build}`,
    };
  };
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
  const checks = async (options: Omit<Parameters<typeof checkEndpoints>[0], "origin">) => {
    const lines: string[] = [];
    const result = await checkEndpoints({ origin, ...options, log: (line: string) => lines.push(line) });
    return { ...result, failures: lines.filter((line) => line.startsWith("FAIL")), lines };
  };

  beforeAll(async () => {
    admin = postgres(url!, { max: 1, onnotice: () => {} });
    await admin`CREATE SCHEMA ${admin(schema)}`;
    sql = postgres(url!, {
      max: 12,
      prepare: false,
      onnotice: () => {},
      connection: { options: `-c search_path=${schema}` },
    });
    const [{ current }] = await sql`SELECT current_schema() AS current`;
    if (current !== schema) throw new Error(`Test connection is not isolated (schema: ${current})`);
    const applied = await applyMigrations(sql);
    expect(applied).toContain("0005_update_registrations.sql");
    expect(applied).toContain("0006_update_packages.sql");
    folder = await mkdtemp(join(tmpdir(), "nokka-packages-"));

    const store = createPackageStore(sql);
    const counted: PackageStore = {
      ...store,
      async readChunk(build, index, offset, length) {
        reads.count++;
        reads.bytes += length;
        reads.largest = Math.max(reads.largest, length);
        return store.readChunk(build, index, offset, length);
      },
    };
    const authorizer = createUpdateAuthorizer(sql);
    const deps = {
      authorize: (token: string | null) => authorizer.authorize(token),
      getStore: () => counted,
      getOrigin: () => origin,
    };
    const feed = createAppcastHandlers(deps);
    const packages = createPackageHandlers(deps);
    server = createServer(async (req, res) => {
      const method = req.method === "HEAD" ? "HEAD" : "GET";
      const address = `${origin}${req.url}`;
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) {
        if (typeof value === "string") headers.set(name, value);
      }
      const request = new Request(address, { method, headers });
      const path = new URL(address).pathname;
      const match = /^\/api\/updates\/v1\/packages\/([^/]+)\/Nokka\.dmg$/.exec(path);
      const response =
        path === "/api/updates/v1/appcast.xml"
          ? await feed[method](request)
          : match
            ? await packages[method](request, { params: Promise.resolve({ build: match[1] }) })
            : new Response("not found", { status: 404 });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (!response.body) return void res.end();
      await pipeline(Readable.fromWeb(response.body as import("node:stream/web").ReadableStream), res).catch(() => {});
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    origin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
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

  it("enables row level security and guards the channel and the chunks", async () => {
    const tables = await sql`
      SELECT relname, relrowsecurity FROM pg_class
      WHERE relnamespace = ${schema}::regnamespace AND relkind = 'r'
        AND (relname LIKE 'update_package%' OR relname LIKE 'update_channel%')
      ORDER BY relname
    `;
    expect(tables.map((row) => [row.relname, row.relrowsecurity])).toEqual([
      ["update_channel", true],
      ["update_channel_events", true],
      ["update_package_chunks", true],
      ["update_packages", true],
    ]);
    await expect(sql`INSERT INTO update_channel (bridge_build) VALUES (22)`).rejects.toMatchObject({ code: "23514" });
    await expect(
      sql`INSERT INTO update_package_chunks (build, chunk_index, data) VALUES (999, 0, ${Buffer.from("x")})`,
    ).rejects.toMatchObject({ code: "23001" });
  });

  it("serves an empty feed before anything is published and refuses staging before init", async () => {
    const seeded = await seedRegisteredSession(sql, { email: `nokka-packages-qa-${id}-empty@example.com` });
    const response = await fetch(`${origin}/api/updates/v1/appcast.xml`, {
      headers: { Authorization: `Bearer ${seeded.accessToken}` },
    });
    expect(response.status).toBe(200);
    const xml = await response.text();
    expect(xml).toContain("<channel>");
    expect(xml).not.toContain("<item>");

    const path = await writePackage("early.dmg", 1000);
    await expect(stagePackage(sql, { manifest: await manifestFor(path, 24), filePath: path })).rejects.toThrow(
      /not initialized/,
    );
    expect(await tool("init", "--bridge-build", "22")).toMatchObject({ code: 1 });
    expect(await tool("init", "--bridge-build", String(BRIDGE))).toMatchObject({ code: 0 });
    expect(await tool("init", "--bridge-build", String(BRIDGE))).toMatchObject({ code: 0 });
    expect((await tool("init", "--bridge-build", "30")).stderr).toContain("already exists for bridge build 23");
    await expect(initChannel(sql, BRIDGE)).resolves.toEqual({ created: false });
  });

  it("stages, verifies and publishes a full-size package, resuming the same bytes and refusing others", async () => {
    const path = await writePackage("Nokka-2.7.0-24.dmg", LARGE);
    const manifest = await manifestFor(path, 24);
    const manifestPath = join(folder, "package-24.json");
    await writeFile(manifestPath, JSON.stringify(manifest));
    const chunks = Math.ceil(LARGE / CHUNK_SIZE);

    // An interrupted load: the first chunks are there, the package is not verified, nothing is served.
    await sql`INSERT INTO update_packages ${sql({
      build: 24,
      short_version: manifest.version,
      minimum_system_version: manifest.minimumSystemVersion,
      byte_length: manifest.length,
      sha256: Buffer.from(manifest.sha256, "hex"),
      ed_signature: manifest.edSignature,
      target_cdhash: manifest.targetCDHash,
      release_notes: manifest.notes,
      chunk_size: CHUNK_SIZE,
      chunk_count: chunks,
    })}`;
    const handle = await open(path, "r");
    for (const index of [0, 1]) {
      const data = Buffer.alloc(CHUNK_SIZE);
      await handle.read(data, 0, CHUNK_SIZE, index * CHUNK_SIZE);
      await sql`INSERT INTO update_package_chunks (build, chunk_index, data) VALUES (24, ${index}, ${data})`;
    }
    await handle.close();
    const staged = await stagePackage(sql, { manifest, filePath: path });
    expect(staged).toEqual({ loaded: chunks - 2, reused: 2 });
    expect((await tool("stage", "--manifest", manifestPath, "--file", path)).stdout).toContain("already loaded and verified");
    expect(await verifyPackage(sql, 24, { filePath: path })).toMatchObject({ length: LARGE, chunks, state: "staged" });

    const other = await writePackage("other.dmg", LARGE);
    const otherManifest = { ...(await manifestFor(other, 24)), edSignature: manifest.edSignature };
    await expect(stagePackage(sql, { manifest: otherManifest, filePath: other })).rejects.toThrow(/different package/);
    await expect(stagePackage(sql, { manifest: { ...manifest, notes: "changed" }, filePath: path })).rejects.toThrow(
      /different package/,
    );
    await expect(verifyPackage(sql, 24, { filePath: other })).rejects.toThrow(/not the bytes of the local file/);

    // Verified chunks and descriptions are frozen.
    await expect(sql`UPDATE update_package_chunks SET data = ${Buffer.from("x")} WHERE build = 24 AND chunk_index = 0`)
      .rejects.toMatchObject({ code: "23001" });
    await expect(sql`INSERT INTO update_package_chunks (build, chunk_index, data) VALUES (24, ${chunks}, ${Buffer.from("x")})`)
      .rejects.toMatchObject({ code: "23001" });
    await expect(sql`UPDATE update_packages SET release_notes = 'x' WHERE build = 24`).rejects.toMatchObject({ code: "23001" });

    // Not served while staged.
    const seeded = await seedRegisteredSession(sql, { email: `nokka-packages-qa-${id}-staged@example.com` });
    const early = await fetch(`${origin}/api/updates/v1/packages/24/Nokka.dmg`, {
      method: "HEAD",
      headers: { Authorization: `Bearer ${seeded.accessToken}` },
    });
    expect(early.status).toBe(404);

    expect((await tool("publish", "--build", "24", "--expect-current", "25")).code).toBe(1);
    expect((await tool("publish", "--build", "24")).code).toBe(2);
    const published = await tool("publish", "--build", "24", "--expect-current", "none");
    expect(published).toMatchObject({ code: 0 });
    expect(published.stdout).toContain("now offers build 24");
    expect((await tool("publish", "--build", "24", "--expect-current", "24")).stderr).toContain("published once");
    const status = JSON.parse((await tool("status", "--json")).stdout);
    expect(status.channel).toEqual({ bridgeBuild: BRIDGE, currentBuild: 24, highWaterBuild: 24, nextBuildAbove: 24, installerBuild: null });
    expect(status.packages).toEqual([
      expect.objectContaining({ build: 24, state: "published", length: LARGE, sha256: manifest.sha256, chunksLoaded: chunks }),
    ]);
  });

  it("streams it to an active registration in full, in ranges, in parallel and resumed, and to nobody else", async () => {
    const seeded = await seedRegisteredSession(sql, { email: `nokka-packages-qa-${id}-active@example.com` });
    const manifest = JSON.parse(
      JSON.stringify((await channelStatus(sql)).packages.find((p: { build: number }) => p.build === 24)),
    );
    const [row] = await sql`SELECT ed_signature, target_cdhash FROM update_packages WHERE build = 24`;
    const expected = { build: 24, length: manifest.length, sha256: manifest.sha256, edSignature: row.ed_signature, targetCDHash: row.target_cdhash };

    // The checker as the operator runs it: its own process, the token in a 0600 file.
    const tokenFile = join(folder, "token");
    await writeFile(tokenFile, `${seeded.accessToken}\n`, { mode: 0o600 });
    const manifestFile = join(folder, "expected.json");
    await writeFile(manifestFile, JSON.stringify(expected));
    reads.count = reads.bytes = reads.largest = 0;
    const cli = await run(process.execPath, [
      CHECKER, "--origin", origin, "--token-file", tokenFile, "--manifest", manifestFile, "--parallel", "3",
    ]).then(
      (done) => ({ code: 0, out: done.stdout }),
      (error) => ({ code: error.code as number, out: `${error.stdout}${error.stderr}` }),
    );
    expect(cli.out.split("\n").filter((line) => line.startsWith("FAIL"))).toEqual([]);
    expect(cli.code).toBe(0);
    expect(cli.out).toMatch(/\n\d{2,} checks, 0 failed\.\n$/);
    expect(cli.out).not.toContain(seeded.accessToken);
    // Chunk-sized reads only.
    expect(reads.largest).toBeLessThanOrEqual(CHUNK_SIZE);
    expect(reads.largest).toBe(CHUNK_SIZE);

    // A client that stops reading: the server reads only what fits in the socket buffers and one chunk
    // ahead, not the rest of the file, and stops reading when the client goes away.
    reads.count = 0;
    const slow = await fetch(`${origin}/api/updates/v1/packages/24/Nokka.dmg`, {
      headers: { Authorization: `Bearer ${seeded.accessToken}` },
    });
    const reader = slow.body!.getReader();
    await reader.read();
    await new Promise((resolve) => setTimeout(resolve, 400));
    const whilePaused = reads.count;
    expect(whilePaused).toBeLessThan(16);
    expect(whilePaused).toBeLessThan(Math.ceil(LARGE / CHUNK_SIZE) / 4);
    await reader.cancel();
    await new Promise((resolve) => setTimeout(resolve, 200));
    const afterCancel = reads.count;
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(reads.count).toBe(afterCancel);

    // Revoking the approval stops the next request of the same token, feed and package alike.
    await revokeUpdatesForTest(sql, seeded.applicationId);
    const revoked = await checks({ token: seeded.accessToken, expect: "inactive", build: 24 });
    expect(revoked.failures).toEqual([]);
    const anonymous = await checks({ build: 24 });
    expect(anonymous.failures).toEqual([]);
  });

  it("serves only published builds and moves the pointer forwards, or back with the bad build withdrawn", async () => {
    const seeded = await seedRegisteredSession(sql, { email: `nokka-packages-qa-${id}-rollback@example.com` });
    const head = (build: number) =>
      fetch(`${origin}/api/updates/v1/packages/${build}/Nokka.dmg`, {
        method: "HEAD",
        headers: { Authorization: `Bearer ${seeded.accessToken}` },
      }).then((response) => response.status);
    const feedBuild = async () => {
      const xml = await (
        await fetch(`${origin}/api/updates/v1/appcast.xml`, { headers: { Authorization: `Bearer ${seeded.accessToken}` } })
      ).text();
      return /<sparkle:version>(\d+)</.exec(xml)?.[1] ?? null;
    };

    const small = await writePackage("Nokka-2.7.1-25.dmg", CHUNK_SIZE + 1);
    await expect(stagePackage(sql, { manifest: await manifestFor(small, 24), filePath: small })).rejects.toThrow(
      /not above build 24/,
    );
    await stagePackage(sql, { manifest: await manifestFor(small, 25, "2.7.1"), filePath: small });
    const exact = await writePackage("Nokka-2.7.2-26.dmg", CHUNK_SIZE);
    await stagePackage(sql, { manifest: await manifestFor(exact, 26, "2.7.2"), filePath: exact });

    // Two publishers that both saw build 24: exactly one moves the feed.
    const raced = await Promise.allSettled([publishPackage(sql, 25, 24), publishPackage(sql, 26, 24)]);
    expect(raced.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(String((raced.find((r) => r.status === "rejected") as PromiseRejectedResult).reason)).toMatch(/feed shows build/);
    const winner = Number(await feedBuild());
    expect([25, 26]).toContain(winner);
    expect(await head(winner)).toBe(200);
    expect(await head(24)).toBe(200); // an earlier published build stays downloadable
    if (winner === 25) await publishPackage(sql, 26, 25);
    else {
      await expect(publishPackage(sql, 25, 26)).rejects.toThrow(/not above build 26/);
      await discardPackage(sql, 25);
    }
    expect(await feedBuild()).toBe("26");

    await expect(withdrawPackage(sql, 26)).rejects.toThrow(/roll back first/);
    await expect(rollbackChannel(sql, { to: 26, expectCurrent: 26 })).rejects.toThrow(/not below/);
    await rollbackChannel(sql, { to: 24, expectCurrent: 26 });
    expect(await feedBuild()).toBe("24");
    expect(await head(26)).toBe(404);
    await expect(publishPackage(sql, 26, 24)).rejects.toThrow(/published once/);

    const fixed = await writePackage("Nokka-2.7.3-27.dmg", 70_000);
    await stagePackage(sql, { manifest: await manifestFor(fixed, 27, "2.7.3"), filePath: fixed });
    await expect(publishPackage(sql, 27, null)).rejects.toThrow(/feed shows build 24/);
    await publishPackage(sql, 27, 24);
    expect(await feedBuild()).toBe("27");

    expect((await tool("withdraw", "--build", "24")).stdout).toContain("Withdrawn.");
    expect(await head(24)).toBe(404);
    await expect(rollbackChannel(sql, { to: 24, expectCurrent: 27 })).rejects.toThrow(/not a published build/);
    expect((await tool("rollback", "--to", "none", "--expect-current", "27")).code).toBe(0);
    expect(await feedBuild()).toBe(null);
    expect(await head(27)).toBe(404);
    await expect(sql`DELETE FROM update_packages WHERE build = 27`).rejects.toMatchObject({ code: "23001" });

    const events = (await channelStatus(sql)).events.map((e: { action: string; build: number | null }) => [e.action, e.build]);
    expect(events.slice(0, 3)).toEqual([["rollback", null], ["withdraw", 24], ["publish", 27]]);
  });

  it("reports usage errors without touching the database", async () => {
    for (const args of [[], ["bogus"], ["publish", "--build", "x", "--expect-current", "none"], ["stage", "--manifest"]]) {
      expect((await tool(...args)).code, args.join(" ")).toBe(2);
    }
    const missing = await run(process.execPath, [TOOL, "status"], { env: { ...process.env, DATABASE_URL: "" } }).catch(
      (error) => error,
    );
    expect(missing.code).toBe(2);
  });
});
