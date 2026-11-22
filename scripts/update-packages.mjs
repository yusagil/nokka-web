// Loads, checks and publishes protected Nokka update packages (db/migrations/0006_update_packages.sql).
// Run from a trusted machine by the release operator; there is no upload API. Nothing is published
// until a package was read back whole against its SHA-256, and the feed pointer moves last, in one
// transaction that also refuses a build that is not above every build published before.
//
// Usage: DATABASE_URL=... node scripts/update-packages.mjs <command> [options]
//   status [--json]                          channel, packages and recent changes (no bytes)
//   init --bridge-build <B>                  create the empty protected channel above bridge build B (> 22)
//   stage --manifest <package.json> --file <Nokka.dmg>
//                                            load the DMG in 512 KiB chunks, read it back, mark it verified;
//                                            safe to repeat (same bytes resume, other bytes stop). The bridge
//                                            build B can be staged too: it is never published, only handed
//                                            out by install links (installer)
//   verify --build <N> [--file <Nokka.dmg>]  read a stored package back (and compare it with a local file)
//   publish --build <N> --expect-current <build|none>
//                                            offer a verified package; the channel must still be at the
//                                            expected build, so concurrent publishers can not both win
//   rollback --to <build|none> --expect-current <N>
//                                            point the feed back to an earlier published build (or none)
//                                            and withdraw N; fix forward with a higher build
//   withdraw --build <N>                     stop serving a build that is not in the feed (and its install
//                                            links; if it was the installer, new links stop until set again)
//   installer --build <N|none>               the package new install links serve: the verified bridge build
//                                            or a published build; none stops issuing links (links already
//                                            issued keep their build until they expire or are revoked)
//   discard --build <N>                      delete a package that was never published
// The manifest comes from the app's scripts/release/make-protected-package.sh.
// Exit status: 0 done, 1 a check failed or the database refused, 2 usage error.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import postgres from "postgres";

export const CHUNK_SIZE = 512 * 1024;
export const MANIFEST_FORMAT = "nokka-update-package-v1";
// 2.6.2 is build 22: the bridge build and every protected build are above it.
export const LEGACY_BUILD = 22;
const MAX_BUILD = 2_147_483_647;
const VERSION = /^[0-9]{1,4}(\.[0-9]{1,4}){0,3}$/;
const SYSTEM_VERSION = /^[0-9]{1,3}(\.[0-9]{1,3}){0,2}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const ED_SIGNATURE = /^[A-Za-z0-9+/]{86}==$/;
const CDHASH = /^[0-9a-f]{40}$/;
const NOTES_FORBIDDEN = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/;
const MANIFEST_KEYS = [
  "format",
  "build",
  "version",
  "minimumSystemVersion",
  "length",
  "sha256",
  "edSignature",
  "targetCDHash",
  "notes",
];

/** A check that failed; the message is safe to print. */
export class PackageToolError extends Error {}
class UsageError extends Error {}

const fail = (message) => {
  throw new PackageToolError(message);
};

/** Parses and checks a manifest written by make-protected-package.sh. */
export function parseManifest(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    fail("The manifest is not JSON.");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail("The manifest is not an object.");
  const keys = Object.keys(value).sort();
  if (keys.join() !== [...MANIFEST_KEYS].sort().join()) {
    fail(`The manifest must have exactly these keys: ${MANIFEST_KEYS.join(", ")}.`);
  }
  const m = value;
  if (m.format !== MANIFEST_FORMAT) fail(`The manifest format is not ${MANIFEST_FORMAT}.`);
  if (!isBuild(m.build) || m.build <= LEGACY_BUILD) fail(`build must be a whole number above ${LEGACY_BUILD}.`);
  if (typeof m.version !== "string" || !VERSION.test(m.version)) fail("version must look like 2.7.0.");
  if (typeof m.minimumSystemVersion !== "string" || !SYSTEM_VERSION.test(m.minimumSystemVersion)) {
    fail("minimumSystemVersion must look like 14.0.");
  }
  if (!Number.isSafeInteger(m.length) || m.length <= 0) fail("length must be a positive whole number.");
  if (typeof m.sha256 !== "string" || !SHA256_HEX.test(m.sha256)) fail("sha256 must be 64 lowercase hex digits.");
  if (typeof m.edSignature !== "string" || !ED_SIGNATURE.test(m.edSignature)) {
    fail("edSignature must be Sparkle's 64-byte EdDSA signature in base64.");
  }
  if (typeof m.targetCDHash !== "string" || !CDHASH.test(m.targetCDHash)) {
    fail("targetCDHash must be 40 lowercase hex digits.");
  }
  if (typeof m.notes !== "string" || m.notes.length > 20000 || NOTES_FORBIDDEN.test(m.notes)) {
    fail("notes must be plain text (up to 20000 characters, no control characters but tab and newline).");
  }
  return m;
}

/** Length and SHA-256 (hex) of a file, read as a stream. */
export async function hashFile(path) {
  const hash = createHash("sha256");
  let length = 0;
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
    length += chunk.length;
  }
  return { length, sha256: hash.digest("hex") };
}

const chunkCount = (length) => Math.ceil(length / CHUNK_SIZE);

async function readChannel(sql, { lock = false } = {}) {
  const [row] = lock
    ? await sql`SELECT bridge_build, current_build, high_water_build, installer_build FROM update_channel WHERE id FOR UPDATE`
    : await sql`SELECT bridge_build, current_build, high_water_build, installer_build FROM update_channel WHERE id`;
  return row ?? null;
}

const floorOf = (channel) => Math.max(channel.bridge_build, channel.high_water_build ?? 0);

/** Creates the empty channel; repeating it with the same bridge build changes nothing. */
export async function initChannel(sql, bridgeBuild) {
  if (!isBuild(bridgeBuild) || bridgeBuild <= LEGACY_BUILD) {
    fail(`The bridge build must be a whole number above ${LEGACY_BUILD} (2.6.2).`);
  }
  return sql.begin(async (tx) => {
    const [created] = await tx`
      INSERT INTO update_channel (id, bridge_build) VALUES (true, ${bridgeBuild})
      ON CONFLICT (id) DO NOTHING
      RETURNING bridge_build
    `;
    if (created) {
      await tx`INSERT INTO update_channel_events (action, build) VALUES ('init', ${bridgeBuild})`;
      return { created: true };
    }
    const channel = await readChannel(tx);
    if (channel.bridge_build !== bridgeBuild) {
      fail(`The channel already exists for bridge build ${channel.bridge_build}, not ${bridgeBuild}.`);
    }
    return { created: false };
  });
}

/**
 * Loads `filePath` as the package the manifest describes, reads it back and marks it verified. A build
 * that already holds a different description or other bytes is refused; the same ones resume.
 */
export async function stagePackage(sql, { manifest, filePath, log = () => {} }) {
  const local = await hashFile(filePath);
  if (local.length !== manifest.length || local.sha256 !== manifest.sha256) {
    fail("The file is not the one the manifest describes (length or SHA-256 differ).");
  }
  const channel = await readChannel(sql);
  if (!channel) fail("The protected channel is not initialized (init --bridge-build <B>).");
  // The bridge build is never published; staged, it can only be handed out by install links.
  if (manifest.build !== channel.bridge_build && manifest.build <= floorOf(channel)) {
    fail(`Build ${manifest.build} is not above build ${floorOf(channel)} (bridge or last published); it could never be published.`);
  }

  const count = chunkCount(manifest.length);
  const description = {
    build: manifest.build,
    short_version: manifest.version,
    minimum_system_version: manifest.minimumSystemVersion,
    byte_length: manifest.length,
    sha256: Buffer.from(manifest.sha256, "hex"),
    ed_signature: manifest.edSignature,
    target_cdhash: manifest.targetCDHash,
    release_notes: manifest.notes,
    chunk_size: CHUNK_SIZE,
    chunk_count: count,
  };
  await sql`INSERT INTO update_packages ${sql(description)} ON CONFLICT (build) DO NOTHING`;
  const [stored] = await sql`
    SELECT short_version, minimum_system_version, byte_length, sha256, ed_signature, target_cdhash,
           release_notes, chunk_size, chunk_count, state, verified_at
    FROM update_packages WHERE build = ${manifest.build}
  `;
  const same =
    stored.short_version === description.short_version &&
    stored.minimum_system_version === description.minimum_system_version &&
    Number(stored.byte_length) === description.byte_length &&
    Buffer.compare(stored.sha256, description.sha256) === 0 &&
    stored.ed_signature === description.ed_signature &&
    stored.target_cdhash === description.target_cdhash &&
    stored.release_notes === description.release_notes &&
    stored.chunk_size === description.chunk_size &&
    stored.chunk_count === description.chunk_count;
  if (!same) fail(`Build ${manifest.build} already holds a different package; use a new build number.`);
  if (stored.state !== "staged") fail(`Build ${manifest.build} is already ${stored.state}.`);
  if (stored.verified_at) {
    log(`Build ${manifest.build} is already loaded and verified.`);
    return { loaded: 0, reused: count };
  }

  const file = await open(filePath, "r");
  let loaded = 0;
  let reused = 0;
  try {
    const buffer = Buffer.alloc(CHUNK_SIZE);
    for (let index = 0; index < count; index++) {
      const size = Math.min(CHUNK_SIZE, manifest.length - index * CHUNK_SIZE);
      const { bytesRead } = await file.read(buffer, 0, size, index * CHUNK_SIZE);
      if (bytesRead !== size) fail("The file changed while it was being loaded.");
      const data = Buffer.from(buffer.subarray(0, size));
      const inserted = await sql`
        INSERT INTO update_package_chunks (build, chunk_index, data)
        VALUES (${manifest.build}, ${index}, ${data})
        ON CONFLICT (build, chunk_index) DO NOTHING
        RETURNING chunk_index
      `;
      if (inserted.length) {
        loaded++;
        continue;
      }
      const [existing] = await sql`
        SELECT sha256(data) AS digest FROM update_package_chunks
        WHERE build = ${manifest.build} AND chunk_index = ${index}
      `;
      if (Buffer.compare(existing.digest, createHash("sha256").update(data).digest()) !== 0) {
        fail(`Chunk ${index} of build ${manifest.build} already holds other bytes; discard the build first.`);
      }
      reused++;
    }
  } finally {
    await file.close();
  }
  log(`Loaded ${loaded} chunks, ${reused} already there; reading build ${manifest.build} back.`);
  await verifyPackage(sql, manifest.build, { markVerified: true });
  return { loaded, reused };
}

/**
 * Reads a package back chunk by chunk and checks every chunk size, the total length and the SHA-256
 * (and a local file, when given). With `markVerified` it holds the package row for the whole read, so no
 * chunk can change under it, and records the verification.
 */
/**
 * @param {import("postgres").Sql} sql
 * @param {number} build
 * @param {{ filePath?: string, markVerified?: boolean }} [options]
 */
export async function verifyPackage(sql, build, { filePath, markVerified = false } = {}) {
  if (!isBuild(build)) fail("The build must be a positive whole number.");
  const check = async (db) => {
    const [pkg] = markVerified
      ? await db`SELECT byte_length, sha256, chunk_size, chunk_count, state, verified_at
                 FROM update_packages WHERE build = ${build} FOR UPDATE`
      : await db`SELECT byte_length, sha256, chunk_size, chunk_count, state, verified_at
                 FROM update_packages WHERE build = ${build}`;
    if (!pkg) fail(`There is no package for build ${build}.`);
    const length = Number(pkg.byte_length);
    const [{ extra }] = await db`
      SELECT count(*)::int AS extra FROM update_package_chunks
      WHERE build = ${build} AND (chunk_index < 0 OR chunk_index >= ${pkg.chunk_count})
    `;
    if (extra) fail(`Build ${build} has ${extra} chunks outside its length.`);
    const hash = createHash("sha256");
    let total = 0;
    for (let index = 0; index < pkg.chunk_count; index++) {
      const expected = Math.min(pkg.chunk_size, length - index * pkg.chunk_size);
      const [row] = await db`
        SELECT data FROM update_package_chunks WHERE build = ${build} AND chunk_index = ${index}
      `;
      if (!row) fail(`Chunk ${index} of build ${build} is missing.`);
      if (row.data.length !== expected) fail(`Chunk ${index} of build ${build} has ${row.data.length} bytes, not ${expected}.`);
      hash.update(row.data);
      total += row.data.length;
    }
    const digest = hash.digest();
    if (total !== length || Buffer.compare(digest, pkg.sha256) !== 0) {
      fail(`Build ${build} read back does not match its recorded length and SHA-256.`);
    }
    if (filePath) {
      const local = await hashFile(filePath);
      if (local.length !== length || local.sha256 !== digest.toString("hex")) {
        fail(`Build ${build} is not the bytes of the local file.`);
      }
    }
    if (markVerified && pkg.state === "staged" && !pkg.verified_at) {
      await db`UPDATE update_packages SET verified_at = now() WHERE build = ${build}`;
    }
    return { length, sha256: digest.toString("hex"), chunks: pkg.chunk_count, state: pkg.state };
  };
  return markVerified ? sql.begin((tx) => check(tx)) : check(sql);
}

/** Offers a verified package in the feed. `expectCurrent` is the build the feed shows now, or null. */
export async function publishPackage(sql, build, expectCurrent) {
  if (!isBuild(build)) fail("The build must be a positive whole number.");
  return sql.begin(async (tx) => {
    const channel = await readChannel(tx, { lock: true });
    if (!channel) fail("The protected channel is not initialized (init --bridge-build <B>).");
    if (channel.current_build !== expectCurrent) {
      fail(`The feed shows ${describe(channel.current_build)}, not ${describe(expectCurrent)}; check status and try again.`);
    }
    const [pkg] = await tx`
      SELECT byte_length, chunk_size, chunk_count, state, verified_at
      FROM update_packages WHERE build = ${build} FOR UPDATE
    `;
    if (!pkg) fail(`There is no package for build ${build}; stage it first.`);
    if (pkg.state !== "staged") fail(`Build ${build} is ${pkg.state}; a build is published once.`);
    if (!pkg.verified_at) fail(`Build ${build} is not verified; run stage (or verify) again.`);
    if (build <= floorOf(channel)) {
      fail(`Build ${build} is not above build ${floorOf(channel)} (bridge or last published).`);
    }
    await checkChunkShape(tx, build, pkg);
    await tx`UPDATE update_packages SET state = 'published', published_at = now() WHERE build = ${build}`;
    await tx`
      UPDATE update_channel SET current_build = ${build}, high_water_build = ${build}, updated_at = now()
      WHERE id
    `;
    await tx`
      INSERT INTO update_channel_events (action, build, previous_build)
      VALUES ('publish', ${build}, ${channel.current_build})
    `;
    return { previous: channel.current_build };
  });
}

/** Every chunk is there with its verified size (a cheap recheck before a package is offered). */
async function checkChunkShape(tx, build, pkg) {
  const [shape] = await tx`
    SELECT count(*)::int AS chunks,
           coalesce(sum(octet_length(data)), 0)::bigint AS total,
           count(*) FILTER (WHERE chunk_index < ${pkg.chunk_count - 1} AND octet_length(data) <> ${pkg.chunk_size})::int AS short
    FROM update_package_chunks WHERE build = ${build}
  `;
  if (shape.chunks !== pkg.chunk_count || Number(shape.total) !== Number(pkg.byte_length) || shape.short) {
    fail(`Build ${build} no longer has the chunks it was verified with.`);
  }
}

/** Points the feed back to an earlier published build (or none) and withdraws the build it showed. */
export async function rollbackChannel(sql, { to, expectCurrent }) {
  if (!isBuild(expectCurrent)) fail("--expect-current must name the build the feed shows now.");
  if (to !== null && !isBuild(to)) fail("--to must be a build or none.");
  return sql.begin(async (tx) => {
    const channel = await readChannel(tx, { lock: true });
    if (!channel) fail("The protected channel is not initialized.");
    if (channel.current_build !== expectCurrent) {
      fail(`The feed shows ${describe(channel.current_build)}, not build ${expectCurrent}; check status and try again.`);
    }
    if (to !== null) {
      if (to >= expectCurrent) fail(`Build ${to} is not below build ${expectCurrent}.`);
      const [target] = await tx`SELECT state FROM update_packages WHERE build = ${to} FOR UPDATE`;
      if (target?.state !== "published") fail(`Build ${to} is not a published build that can be offered again.`);
    }
    await tx`UPDATE update_channel SET current_build = ${to}, updated_at = now() WHERE id`;
    await tx`
      UPDATE update_packages SET state = 'withdrawn', withdrawn_at = now()
      WHERE build = ${expectCurrent} AND state = 'published'
    `;
    await tx`
      INSERT INTO update_channel_events (action, build, previous_build)
      VALUES ('rollback', ${to}, ${expectCurrent})
    `;
    return { installerCleared: await clearInstallerIf(tx, channel, expectCurrent) };
  });
}

/** Stops serving a build that is not the one in the feed. */
export async function withdrawPackage(sql, build) {
  if (!isBuild(build)) fail("The build must be a positive whole number.");
  return sql.begin(async (tx) => {
    const channel = await readChannel(tx, { lock: true });
    if (channel?.current_build === build) {
      fail(`Build ${build} is in the feed; roll back first (rollback --to <build|none> --expect-current ${build}).`);
    }
    const [pkg] = await tx`SELECT state FROM update_packages WHERE build = ${build} FOR UPDATE`;
    if (!pkg) fail(`There is no package for build ${build}.`);
    if (pkg.state === "withdrawn") return { changed: false, installerCleared: false };
    await tx`UPDATE update_packages SET state = 'withdrawn', withdrawn_at = now() WHERE build = ${build}`;
    await tx`INSERT INTO update_channel_events (action, build) VALUES ('withdraw', ${build})`;
    return { changed: true, installerCleared: await clearInstallerIf(tx, channel, build) };
  });
}

/**
 * Points new install links at `build` (null: issue none). The build must be fully stored and verified,
 * not withdrawn, and either the bridge build or a published one. Links already issued keep the build
 * they were issued for.
 */
export async function setInstaller(sql, build) {
  if (build !== null && !isBuild(build)) fail("The build must be a build number or none.");
  return sql.begin(async (tx) => {
    const channel = await readChannel(tx, { lock: true });
    if (!channel) fail("The protected channel is not initialized (init --bridge-build <B>).");
    if (build !== null) {
      const [pkg] = await tx`
        SELECT byte_length, chunk_size, chunk_count, state, verified_at
        FROM update_packages WHERE build = ${build} FOR UPDATE
      `;
      if (!pkg) fail(`There is no package for build ${build}; stage it first.`);
      if (!pkg.verified_at) fail(`Build ${build} is not verified; run stage (or verify) again.`);
      if (pkg.state === "withdrawn") fail(`Build ${build} is withdrawn and is never served again.`);
      if (pkg.state !== "published" && build !== channel.bridge_build) {
        fail(`Build ${build} is neither the bridge build ${channel.bridge_build} nor published; publish it first.`);
      }
      await checkChunkShape(tx, build, pkg);
    }
    if (channel.installer_build === build) return { changed: false, previous: build };
    await tx`UPDATE update_channel SET installer_build = ${build}, updated_at = now() WHERE id`;
    await tx`
      INSERT INTO update_channel_events (action, build, previous_build)
      VALUES ('installer', ${build}, ${channel.installer_build})
    `;
    return { changed: true, previous: channel.installer_build };
  });
}

/** In a transaction holding the channel lock: stops new install links for a build being withdrawn. */
async function clearInstallerIf(tx, channel, build) {
  if (channel?.installer_build !== build) return false;
  await tx`UPDATE update_channel SET installer_build = NULL, updated_at = now() WHERE id`;
  await tx`INSERT INTO update_channel_events (action, build, previous_build) VALUES ('installer', NULL, ${build})`;
  return true;
}

/** Deletes a package that was never published, so its build can be staged again. */
export async function discardPackage(sql, build) {
  if (!isBuild(build)) fail("The build must be a positive whole number.");
  return sql.begin(async (tx) => {
    const channel = await readChannel(tx, { lock: true });
    const [pkg] = await tx`SELECT state FROM update_packages WHERE build = ${build} FOR UPDATE`;
    if (!pkg) fail(`There is no package for build ${build}.`);
    if (pkg.state !== "staged") fail(`Build ${build} was ${pkg.state}; only a package never published can be discarded.`);
    if (channel?.installer_build === build) fail(`Build ${build} is the installer; set another one (installer --build <N|none>) first.`);
    const [linked] = await tx`SELECT 1 FROM update_install_links WHERE build = ${build} LIMIT 1`;
    if (linked) fail(`Build ${build} was handed out by install links; withdraw it instead.`);
    await tx`DELETE FROM update_package_chunks WHERE build = ${build}`;
    await tx`DELETE FROM update_packages WHERE build = ${build}`;
  });
}

/** Channel, packages and the last 20 changes, without bytes. */
export async function channelStatus(sql) {
  const channel = await readChannel(sql);
  const packages = await sql`
    SELECT p.build, p.short_version, p.state, p.byte_length, encode(p.sha256, 'hex') AS sha256,
           p.target_cdhash, p.verified_at, p.published_at, p.withdrawn_at,
           (SELECT count(*)::int FROM update_package_chunks c WHERE c.build = p.build) AS chunks_loaded,
           p.chunk_count
    FROM update_packages p ORDER BY p.build
  `;
  const events = await sql`
    SELECT action, build, previous_build, created_at FROM update_channel_events ORDER BY id DESC LIMIT 20
  `;
  return {
    channel: channel && {
      bridgeBuild: channel.bridge_build,
      currentBuild: channel.current_build,
      highWaterBuild: channel.high_water_build,
      // What a new protected build must be above (make-protected-package.sh --after-build).
      nextBuildAbove: floorOf(channel),
      // What new install links serve (null: none can be issued).
      installerBuild: channel.installer_build,
    },
    packages: packages.map((p) => ({
      build: p.build,
      version: p.short_version,
      state: p.state,
      length: Number(p.byte_length),
      sha256: p.sha256,
      targetCDHash: p.target_cdhash,
      chunksLoaded: p.chunks_loaded,
      chunkCount: p.chunk_count,
      verifiedAt: p.verified_at?.toISOString() ?? null,
      publishedAt: p.published_at?.toISOString() ?? null,
      withdrawnAt: p.withdrawn_at?.toISOString() ?? null,
    })),
    events: events.map((e) => ({
      action: e.action,
      build: e.build,
      previousBuild: e.previous_build,
      at: e.created_at.toISOString(),
    })),
  };
}

const INSTALLER_CLEARED = "It was the installer: no new install links until installer --build <N> is set again.";

function isBuild(value) {
  return Number.isInteger(value) && value > 0 && value <= MAX_BUILD;
}

function describe(build) {
  return build === null ? "no build" : `build ${build}`;
}

// --- command line ---

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (flag === "--json") {
      options.json = true;
      continue;
    }
    if (!/^--[a-z-]+$/.test(flag)) throw new UsageError(`Unexpected argument: ${flag}`);
    const value = rest[i + 1];
    if (value === undefined || value === "" || value.startsWith("--")) throw new UsageError(`${flag} needs a value.`);
    options[flag.slice(2)] = value;
    i++;
  }
  return { command, options };
}

function buildOption(options, name, { allowNone = false } = {}) {
  const value = options[name];
  if (value === undefined) throw new UsageError(`--${name} is required.`);
  if (allowNone && value === "none") return null;
  if (!/^[1-9][0-9]{0,9}$/.test(value) || Number(value) > MAX_BUILD) {
    throw new UsageError(`--${name} must be a build number${allowNone ? " or none" : ""}.`);
  }
  return Number(value);
}

function onlyOptions(options, allowed) {
  const extra = Object.keys(options).filter((key) => !allowed.includes(key));
  if (extra.length) throw new UsageError(`Unknown option: --${extra[0]}`);
}

async function run(argv, sql) {
  const { command, options } = parseArgs(argv);
  switch (command) {
    case "status": {
      onlyOptions(options, ["json"]);
      const status = await channelStatus(sql);
      if (options.json) {
        console.log(JSON.stringify(status, null, 2));
        return;
      }
      if (!status.channel) console.log("Channel: not initialized (empty feed)");
      else {
        const c = status.channel;
        console.log(`Channel: bridge ${c.bridgeBuild}, feed ${describe(c.currentBuild)}, highest published ${c.highWaterBuild ?? "none"}, next build above ${c.nextBuildAbove}, install links ${describe(c.installerBuild)}`);
      }
      for (const p of status.packages) {
        console.log(`  ${p.build} ${p.version} ${p.state}${p.verifiedAt ? " verified" : ""} ${p.length} bytes ${p.chunksLoaded}/${p.chunkCount} chunks sha256 ${p.sha256}`);
      }
      for (const e of status.events) console.log(`  ${e.at} ${e.action} ${e.build ?? "none"} (was ${e.previousBuild ?? "none"})`);
      return;
    }
    case "init": {
      onlyOptions(options, ["bridge-build"]);
      const { created } = await initChannel(sql, buildOption(options, "bridge-build"));
      console.log(created ? "Channel created (empty feed)." : "Channel already exists for this bridge build.");
      return;
    }
    case "stage": {
      onlyOptions(options, ["manifest", "file"]);
      if (!options.manifest || !options.file) throw new UsageError("stage needs --manifest and --file.");
      let text;
      try {
        text = await readFile(options.manifest, "utf8");
      } catch {
        throw new UsageError("The manifest file can not be read.");
      }
      const manifest = parseManifest(text);
      const result = await stagePackage(sql, { manifest, filePath: options.file, log: console.log });
      console.log(`Build ${manifest.build} staged and verified (${result.loaded} chunks loaded, ${result.reused} reused).`);
      return;
    }
    case "verify": {
      onlyOptions(options, ["build", "file"]);
      const result = await verifyPackage(sql, buildOption(options, "build"), { filePath: options.file });
      console.log(`Build ${buildOption(options, "build")} (${result.state}): ${result.length} bytes in ${result.chunks} chunks, SHA-256 ${result.sha256}${options.file ? ", same as the file" : ""}.`);
      return;
    }
    case "publish": {
      onlyOptions(options, ["build", "expect-current"]);
      const build = buildOption(options, "build");
      const { previous } = await publishPackage(sql, build, buildOption(options, "expect-current", { allowNone: true }));
      console.log(`The protected feed now offers build ${build} (was ${describe(previous)}).`);
      return;
    }
    case "rollback": {
      onlyOptions(options, ["to", "expect-current"]);
      const to = buildOption(options, "to", { allowNone: true });
      const current = buildOption(options, "expect-current");
      const { installerCleared } = await rollbackChannel(sql, { to, expectCurrent: current });
      console.log(`The protected feed now offers ${describe(to)}; build ${current} is withdrawn.`);
      if (installerCleared) console.log(INSTALLER_CLEARED);
      return;
    }
    case "withdraw": {
      onlyOptions(options, ["build"]);
      const { changed, installerCleared } = await withdrawPackage(sql, buildOption(options, "build"));
      console.log(changed ? "Withdrawn." : "Already withdrawn.");
      if (installerCleared) console.log(INSTALLER_CLEARED);
      return;
    }
    case "installer": {
      onlyOptions(options, ["build"]);
      const build = buildOption(options, "build", { allowNone: true });
      const { changed, previous } = await setInstaller(sql, build);
      if (!changed) console.log(`New install links already serve ${describe(build)}.`);
      else if (build === null) console.log(`No new install links can be issued (was ${describe(previous)}); issued links keep their build.`);
      else console.log(`New install links serve build ${build} (was ${describe(previous)}).`);
      return;
    }
    case "discard": {
      onlyOptions(options, ["build"]);
      await discardPackage(sql, buildOption(options, "build"));
      console.log("Discarded.");
      return;
    }
    default:
      throw new UsageError(command ? `Unknown command: ${command}` : "No command.");
  }
}

async function main() {
  const usage = () => console.error("See the comment at the top of scripts/update-packages.mjs for usage.");
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set.");
    process.exitCode = 2;
    return;
  }
  const sql = postgres(url, { max: 2, prepare: false, connect_timeout: 10, onnotice: () => {} });
  try {
    await run(process.argv.slice(2), sql);
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`ERROR: ${error.message}`);
      usage();
      process.exitCode = 2;
    } else if (error instanceof PackageToolError) {
      console.error(`ERROR: ${error.message}`);
      process.exitCode = 1;
    } else {
      // Only the error class and code: messages can include connection details.
      console.error("ERROR: database or file error:", error?.name ?? "Error", error?.code ?? "");
      process.exitCode = 1;
    }
  } finally {
    await sql.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
