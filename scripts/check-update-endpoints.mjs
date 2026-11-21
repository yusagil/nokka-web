// Checks the protected update feed and package download over HTTP, the way the app and an outsider
// see them. Read only: GET and HEAD requests, no redirects followed, nothing written on the server.
//
// Usage: node scripts/check-update-endpoints.mjs --origin <https://host> [options]
//   --token-file <file>   an access token (POST /api/updates/v1/sessions) in a file only you can read
//                         (mode 0600); never printed. Without it only the anonymous checks run.
//   --expect <state>      what the token should get: active (default with a token), inactive (403) or
//                         invalid (401, for example an expired token)
//   --build <N>           the package to request (default: the feed's build, else 2147483647)
//   --manifest <file>     the package manifest (make-protected-package.sh): an active token must then get
//                         exactly its build, length and SHA-256, in full, in parts and resumed
//   --parallel <n>        full downloads at the same time (default 1)
// Every protected answer must carry Cache-Control private, no-store and Vary: Authorization. A refused
// request must get a short JSON error: no package bytes, no validators, no Location. After an active
// download the same URLs are requested again without a token.
// Exit status: 0 every check passed, 1 a check failed, 2 usage error.
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const FEED_PATH = "/api/updates/v1/appcast.xml";
const packagePath = (build) => `/api/updates/v1/packages/${build}/Nokka.dmg`;
const UNKNOWN_TOKEN = "A".repeat(43);
const RESUME_AT = 1024 * 1024 + 17; // inside the third 512 KiB chunk

class UsageError extends Error {}

/**
 * @param {{ origin: string, token?: string | null, expect?: string, build?: number | null,
 *   manifest?: { build: number, length: number, sha256: string, edSignature: string, targetCDHash: string } | null,
 *   parallel?: number, log?: (line: string) => void }} options
 */
export async function checkEndpoints({ origin, token = null, expect = token ? "active" : "anonymous", build = null, manifest = null, parallel = 1, log = console.log }) {
  const results = [];
  const record = (ok, label, detail = "") => {
    results.push({ ok, label });
    log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  };
  const request = (path, { method = "GET", auth = null, headers = {}, signal } = {}) =>
    fetch(origin + path, {
      method,
      redirect: "manual",
      signal,
      headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), "Accept-Encoding": "identity", ...headers },
    });

  const checkPrivate = (label, response) => {
    const cache = response.headers.get("cache-control") ?? "";
    const vary = response.headers.get("vary") ?? "";
    const ok = /\bprivate\b/.test(cache) && /\bno-store\b/.test(cache) && /\bauthorization\b/i.test(vary);
    record(ok, `${label}: private, no-store, Vary Authorization`, ok ? "" : `Cache-Control "${cache}", Vary "${vary}"`);
  };

  const refused = async (label, response, status, code) => {
    const body = response.status === 204 || label.includes("HEAD") ? new Uint8Array() : new Uint8Array(await response.arrayBuffer());
    const leaked = ["content-range", "etag", "accept-ranges", "location"].filter((name) => response.headers.has(name));
    let json = null;
    try {
      json = body.length ? JSON.parse(new TextDecoder().decode(body)) : null;
    } catch {
      json = null;
    }
    const codeOk = label.includes("HEAD") ? body.length === 0 : json?.ok === false && json?.code === code;
    const ok = response.status === status && leaked.length === 0 && body.length < 256 && codeOk;
    record(ok, `${label} → ${status} ${code}`, ok ? "" : `got ${response.status}, ${body.length} bytes${leaked.length ? `, headers ${leaked.join(",")}` : ""}`);
    checkPrivate(label, response);
  };

  const refusalSet = async (who, auth, status, code, target) => {
    for (const method of ["GET", "HEAD"]) {
      await refused(`${who} ${method} feed`, await request(FEED_PATH, { method, auth }), status, code);
      await refused(`${who} ${method} package ${target}`, await request(packagePath(target), { method, auth }), status, code);
    }
    await refused(`${who} GET package ${target} Range 0-1023`, await request(packagePath(target), { auth, headers: { Range: "bytes=0-1023" } }), status, code);
    await refused(`${who} GET package ${target} If-None-Match *`, await request(packagePath(target), { auth, headers: { "If-None-Match": "*" } }), status, code);
  };

  let target = build ?? manifest?.build ?? null;
  if (token && expect === "active") {
    const feed = await request(FEED_PATH, { auth: token });
    const xml = await feed.text();
    const items = xml.match(/<item>/g)?.length ?? 0;
    const type = feed.headers.get("content-type") ?? "";
    record(feed.status === 200 && type.startsWith("application/rss+xml") && /<rss[\s>]/.test(xml) && items <= 1,
      "active GET feed → 200 RSS with at most one item", `status ${feed.status}, ${items} items`);
    checkPrivate("active GET feed", feed);
    const head = await request(FEED_PATH, { method: "HEAD", auth: token });
    record(head.status === 200 && head.headers.get("content-type") === type, "active HEAD feed → 200, same type");
    const version = /<sparkle:version>(\d+)<\/sparkle:version>/.exec(xml)?.[1];
    const enclosure = /<enclosure\s[^>]*url="([^"]+)"[^>]*length="(\d+)"/.exec(xml);
    if (version) {
      target ??= Number(version);
      const expected = `${origin}${packagePath(version)}`;
      record(enclosure?.[1] === expected, "feed enclosure is this origin's package URL", enclosure?.[1] === expected ? "" : "another URL");
      if (manifest) {
        record(Number(version) === manifest.build && Number(enclosure?.[2]) === manifest.length,
          `feed offers build ${manifest.build} with length ${manifest.length}`, `build ${version}, length ${enclosure?.[2]}`);
        record(xml.includes(`sparkle:edSignature="${manifest.edSignature}"`) && xml.includes(`<nokka:targetCDHash>${manifest.targetCDHash}</nokka:targetCDHash>`),
          "feed carries the manifest's EdDSA signature and CDHash");
      }
    } else if (manifest) {
      record(false, `feed offers build ${manifest.build}`, "the channel is empty");
    }
    target ??= 2147483647;

    const pkgHead = await request(packagePath(target), { method: "HEAD", auth: token });
    const size = Number(pkgHead.headers.get("content-length"));
    const etag = pkgHead.headers.get("etag");
    record(pkgHead.status === 200 && pkgHead.headers.get("accept-ranges") === "bytes" && size > 0 && Boolean(etag),
      `active HEAD package ${target} → 200, Accept-Ranges bytes, length, ETag`, `status ${pkgHead.status}`);
    checkPrivate(`active HEAD package ${target}`, pkgHead);
    if (manifest) record(size === manifest.length, `HEAD length is the manifest length ${manifest.length}`, `got ${size}`);

    if (pkgHead.status === 200 && size > 0) {
      const ranges = [
        [`0-1023`, 0, Math.min(1023, size - 1)],
        [`-1`, size - 1, size - 1],
        [`${size - 1}-`, size - 1, size - 1],
        [`524287-524288`, 524287, Math.min(524288, size - 1)],
        [`${Math.max(0, size - 700000)}-${size + 5000}`, Math.max(0, size - 700000), size - 1],
      ].filter(([, start]) => start < size);
      const parts = [];
      for (const [spec, start, end] of ranges) {
        const response = await request(packagePath(target), { auth: token, headers: { Range: `bytes=${spec}` } });
        const bytes = new Uint8Array(await response.arrayBuffer());
        const ok = response.status === 206 &&
          response.headers.get("content-range") === `bytes ${start}-${end}/${size}` &&
          bytes.length === end - start + 1 && !response.headers.has("content-encoding");
        record(ok, `active Range ${spec} → 206 bytes ${start}-${end}/${size}`, ok ? "" : `got ${response.status} ${response.headers.get("content-range")}, ${bytes.length} bytes`);
        parts.push({ start, bytes });
      }
      for (const spec of [`${size}-`, `0-1,5-9`, `items=0-1`]) {
        const response = await request(packagePath(target), { auth: token, headers: { Range: spec.startsWith("items") ? spec : `bytes=${spec}` } });
        await response.arrayBuffer();
        record(response.status === 416 && response.headers.get("content-range") === `bytes */${size}`,
          `active Range ${spec} → 416 bytes */${size}`, `got ${response.status}`);
      }
      if (etag) {
        const notModified = await request(packagePath(target), { auth: token, headers: { "If-None-Match": etag } });
        record(notModified.status === 304, "active If-None-Match current ETag → 304", `got ${notModified.status}`);
        const staleRange = await request(packagePath(target), { auth: token, headers: { Range: "bytes=0-9", "If-Range": '"0"' } });
        await staleRange.body?.cancel();
        record(staleRange.status === 200, "active If-Range with another ETag → whole file 200", `got ${staleRange.status}`);
      }

      const downloads = await Promise.all(Array.from({ length: parallel }, () => fullDownload(request, packagePath(target), token)));
      downloads.forEach((d, i) => {
        const ok = d.status === 200 && d.length === size && (!manifest || d.sha256 === manifest.sha256);
        record(ok, `active full download ${i + 1}/${parallel}: ${d.length} bytes${manifest ? ", manifest SHA-256" : ""}`,
          ok ? `${(d.length / 1048576 / Math.max(d.seconds, 0.001)).toFixed(1)} MiB/s` : `status ${d.status}, ${d.length} bytes`);
      });
      const whole = downloads[0];
      if (whole.status === 200) {
        const resumed = await interruptedDownload(request, packagePath(target), token, Math.min(RESUME_AT, size - 1));
        record(resumed.sha256 === whole.sha256 && resumed.length === size,
          `download cut at ${resumed.cutAt} bytes and resumed with Range → same ${size} bytes`, `${resumed.length} bytes`);
        for (const { start, bytes } of parts) {
          // The parts must be the same bytes as the whole download.
          const hash = createHash("sha256").update(bytes).digest("hex");
          const slice = await rangeOfDownload(request, packagePath(target), token, start, bytes.length);
          record(hash === slice, `range at ${start} matches the whole file`);
        }
      }
    }
    // Right after the active download, nobody else gets the same URLs.
    await refusalSet("anonymous after active", null, 401, "INVALID_TOKEN", target);
  } else if (token) {
    target ??= 2147483647;
    if (expect === "inactive") await refusalSet("inactive token", token, 403, "REGISTRATION_INACTIVE", target);
    else await refusalSet("invalid token", token, 401, "INVALID_TOKEN", target);
  }
  target ??= 2147483647;
  await refusalSet("anonymous", null, 401, "INVALID_TOKEN", target);
  await refusalSet("unknown token", UNKNOWN_TOKEN, 401, "INVALID_TOKEN", target);
  return { passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
}

async function fullDownload(request, path, token) {
  const started = performance.now();
  const response = await request(path, { auth: token });
  const hash = createHash("sha256");
  let length = 0;
  if (response.body) {
    for await (const chunk of response.body) {
      hash.update(chunk);
      length += chunk.length;
    }
  }
  return { status: response.status, length, sha256: hash.digest("hex"), seconds: (performance.now() - started) / 1000 };
}

/** Reads the first `cutAt` bytes, drops the connection, then fetches the rest with an open range. */
async function interruptedDownload(request, path, token, cutAt) {
  const controller = new AbortController();
  const response = await request(path, { auth: token, signal: controller.signal });
  const hash = createHash("sha256");
  let length = 0;
  try {
    for await (const chunk of response.body) {
      const take = Math.min(chunk.length, cutAt - length);
      hash.update(chunk.subarray(0, take));
      length += take;
      if (length >= cutAt) break;
    }
  } finally {
    controller.abort();
  }
  const rest = await request(path, { auth: token, headers: { Range: `bytes=${length}-` } });
  for await (const chunk of rest.body) {
    hash.update(chunk);
    length += chunk.length;
  }
  return { cutAt, length, sha256: hash.digest("hex") };
}

async function rangeOfDownload(request, path, token, start, count) {
  const response = await request(path, { auth: token });
  const hash = createHash("sha256");
  let position = 0;
  for await (const chunk of response.body) {
    const from = Math.max(start - position, 0);
    const to = Math.min(start + count - position, chunk.length);
    if (to > from) hash.update(chunk.subarray(from, to));
    position += chunk.length;
    if (position >= start + count) break;
  }
  await response.body?.cancel().catch(() => {});
  return hash.digest("hex");
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!["--origin", "--token-file", "--expect", "--build", "--manifest", "--parallel"].includes(flag)) {
      throw new UsageError(`Unknown argument: ${flag}`);
    }
    if (value === undefined || value === "" || value.startsWith("--")) throw new UsageError(`${flag} needs a value.`);
    options[flag.slice(2)] = value;
  }
  let origin;
  try {
    origin = new URL(options.origin ?? "");
  } catch {
    throw new UsageError("--origin must be an http(s) origin such as https://nokka-web.vercel.app");
  }
  if (!["http:", "https:"].includes(origin.protocol) || origin.pathname !== "/" || origin.search || origin.username) {
    throw new UsageError("--origin must be an http(s) origin without a path, query or user.");
  }
  if (options.expect && !["active", "inactive", "invalid"].includes(options.expect)) {
    throw new UsageError("--expect must be active, inactive or invalid.");
  }
  if (options.expect && !options["token-file"]) throw new UsageError("--expect needs --token-file.");
  if (options.build && !/^[1-9][0-9]{0,9}$/.test(options.build)) throw new UsageError("--build must be a build number.");
  if (options.parallel && !/^[1-8]$/.test(options.parallel)) throw new UsageError("--parallel must be 1 to 8.");
  return { ...options, origin: origin.origin };
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 2;
    return;
  }
  let token = null;
  if (options["token-file"]) {
    const info = await stat(options["token-file"]).catch(() => null);
    if (!info?.isFile()) {
      console.error("ERROR: --token-file can not be read.");
      process.exitCode = 2;
      return;
    }
    if (info.mode & 0o077) {
      console.error("ERROR: --token-file must be readable by you only (chmod 600).");
      process.exitCode = 2;
      return;
    }
    token = (await readFile(options["token-file"], "utf8")).trim();
    if (!/^[A-Za-z0-9_-]{16,512}$/.test(token)) {
      console.error("ERROR: --token-file does not hold a token.");
      process.exitCode = 2;
      return;
    }
  }
  let manifest = null;
  if (options.manifest) {
    try {
      manifest = JSON.parse(await readFile(options.manifest, "utf8"));
    } catch {
      console.error("ERROR: --manifest can not be read as JSON.");
      process.exitCode = 2;
      return;
    }
  }
  try {
    const { passed, failed } = await checkEndpoints({
      origin: options.origin,
      token,
      expect: options.expect,
      build: options.build ? Number(options.build) : null,
      manifest,
      parallel: Number(options.parallel ?? 1),
    });
    console.log(`${passed + failed} checks, ${failed} failed.`);
    process.exitCode = failed ? 1 : 0;
  } catch (error) {
    // Network errors only by class and code: messages can echo the URL.
    console.error("ERROR: request failed:", error?.name ?? "Error", error?.cause?.code ?? error?.code ?? "");
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
