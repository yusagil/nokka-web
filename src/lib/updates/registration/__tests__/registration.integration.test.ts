// @vitest-environment node
// Runs against a real Postgres only when APPLICATIONS_TEST_DATABASE_URL is set (a disposable, direct
// test database). Everything happens in a fresh schema that is dropped afterwards; synthetic data only,
// and mail goes to an in-memory capture (no provider is called).
import { copyFile, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateKeyPairSync, randomBytes, randomUUID, sign, type KeyObject } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, it, expect, vi } from "vitest";
import { applyMigrations } from "../../../../../scripts/db-migrate.mjs";
import { createAdminApplicationsStore } from "@/lib/admin/applications-store";
import type { DigestMail, SendResult } from "@/lib/notifications/mailer";
import { createUpdateAuthorizer } from "../authorize";
import { keyedDigest, registerMessage, sessionMessage } from "../crypto";
import {
  createChallengeHandler,
  createRegistrationHandler,
  createSessionHandler,
  type ChallengeServices,
} from "../handlers";
import { CHALLENGES_PER_EMAIL_PER_HOUR, createRegistrationStore } from "../store";
import { revokeUpdatesForTest, seedRegisteredSession } from "../test-support";

vi.mock("server-only", () => ({}));
// Remote test databases add a round trip per query.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const url = process.env.APPLICATIONS_TEST_DATABASE_URL;
const run = randomUUID().replaceAll("-", "").slice(0, 10);
const schema = `nokka_updates_test_${run}`;
const SECRET = `test-secret-${run}-0123456789abcdef`;
const ORIGIN = "https://nokka-web.vercel.app";
const RUN_PREFIX = `nokka-updates-qa-${run}-`;
const email = (label: string) => `${RUN_PREFIX}${label}@example.com`;
const MIGRATIONS_DIR = fileURLToPath(new URL("../../../../../db/migrations/", import.meta.url));

type Mac = { installationId: string; publicKey: string; privateKey: KeyObject; sign(message: string): string };

function newMac(installationId: string = randomUUID()): Mac {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" });
  const point = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, "base64url"), Buffer.from(jwk.y!, "base64url")]);
  return {
    installationId,
    publicKey: point.toString("base64url"),
    privateKey,
    sign: (message) => sign("sha256", Buffer.from(message), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url"),
  };
}

describe.skipIf(!url)("registered updates on Postgres", () => {
  let admin: postgres.Sql;
  let sql: postgres.Sql;
  /** A second, independent pool for races. */
  let other: postgres.Sql;
  let legacyDir: string;
  const mails: { to: string; mail: DigestMail }[] = [];
  let nextSend: SendResult = { outcome: "accepted", messageId: "18c1f0a2b3c4d5e6" };
  let mailAccess = true;

  const connect = () =>
    postgres(url!, { max: 10, prepare: false, onnotice: () => {}, connection: { options: `-c search_path=${schema}` } });

  beforeAll(async () => {
    admin = postgres(url!, { max: 1, onnotice: () => {} });
    await admin`CREATE SCHEMA ${admin(schema)}`;
    sql = connect();
    other = connect();
    const [{ current }] = await sql`SELECT current_schema() AS current`;
    if (current !== schema) throw new Error(`Test connection is not isolated (schema: ${current})`);

    // Requests that exist before 0005 (one per status) must start without update approval.
    legacyDir = await mkdtemp(join(tmpdir(), "nokka-migrations-"));
    for (const name of (await readdir(MIGRATIONS_DIR)).filter((file) => /^000[1-3]_.*\.sql$/.test(file))) {
      await copyFile(join(MIGRATIONS_DIR, name), join(legacyDir, name));
    }
    await applyMigrations(sql, legacyDir);
    for (const status of ["new", "hold", "contacted"]) {
      await sql`INSERT INTO access_applications (name, email, status) VALUES (${`QA legacy ${status}`}, ${email(`legacy-${status}`)}, ${status})`;
    }
    expect(await applyMigrations(sql)).toContain("0005_update_registrations.sql");
    expect(await applyMigrations(sql)).toEqual([]);
  });

  afterAll(async () => {
    await sql?.end();
    await other?.end();
    if (legacyDir) await rm(legacyDir, { recursive: true, force: true });
    if (admin) {
      await admin`DROP SCHEMA IF EXISTS ${admin(schema)} CASCADE`;
      await admin.end();
    }
  });

  beforeEach(() => {
    mails.length = 0;
    nextSend = { outcome: "accepted", messageId: "18c1f0a2b3c4d5e6" };
    mailAccess = true;
  });

  const allow = { consume: async () => ({ allowed: true as const }) };
  const services = (client: postgres.Sql = sql): ChallengeServices => ({
    store: createRegistrationStore(client, SECRET),
    rateLimiter: allow,
    origin: ORIGIN,
    sender: {
      async authorize() {
        if (!mailAccess) return { ok: false, code: "gmail_token_400_invalid_grant" };
        return {
          ok: true,
          send: async (to, mail) => {
            mails.push({ to, mail });
            return nextSend;
          },
        };
      },
    },
  });
  const post = (body: unknown) =>
    new Request("http://localhost/api/updates/v1/x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const authorizer = () => createUpdateAuthorizer(sql);
  const adminStore = () => createAdminApplicationsStore(sql);

  async function insertApplication(label: string, { approved = false, address = email(label) } = {}) {
    const [row] = await sql`
      INSERT INTO access_applications (name, email, updates_approved) VALUES (${`QA ${label}`}, ${address}, ${approved})
      RETURNING id::text AS id
    `;
    return row.id as string;
  }

  async function requestCode(mac: Mac, address: string) {
    const response = await createChallengeHandler({ getServices: () => services(), minResponseMs: 0 })(
      post({ email: address, installationId: mac.installationId, publicKey: mac.publicKey }),
    );
    return { status: response.status, body: await response.json() };
  }

  const lastCode = () => /^(\d{8})$/m.exec(mails.at(-1)!.mail.text)![1];

  async function register(mac: Mac, challengeId: string, code: string, client: postgres.Sql = sql, signer = mac) {
    const response = await createRegistrationHandler({ getServices: () => services(client) })(
      post({
        challengeId,
        installationId: mac.installationId,
        code,
        signature: signer.sign(registerMessage(ORIGIN, challengeId, mac.installationId, code)),
      }),
    );
    return { status: response.status, body: await response.json() };
  }

  async function openSession(mac: Mac, { nonce = randomBytes(32).toString("base64url"), client = sql } = {}) {
    const issuedAt = Math.floor(Date.now() / 1000);
    const response = await createSessionHandler({ getServices: () => services(client) })(
      post({ installationId: mac.installationId, issuedAt, nonce, signature: mac.sign(sessionMessage(ORIGIN, mac.installationId, issuedAt, nonce)) }),
    );
    return { status: response.status, body: await response.json() };
  }

  /** Approved request + registered Mac + token, all through the API. */
  async function registered(label: string) {
    const id = await insertApplication(label, { approved: true });
    const mac = newMac();
    const { body } = await requestCode(mac, email(label));
    expect((await register(mac, body.challengeId, lastCode())).status).toBe(200);
    const session = await openSession(mac);
    expect(session.status).toBe(200);
    return { id, mac, token: session.body.accessToken as string };
  }

  async function applicationRow(id: string) {
    const [row] = await sql`
      SELECT updates_approved, updates_generation::int AS generation, active_installation_id::text AS active,
             status, operator_note, last_contacted_at
      FROM access_applications WHERE id = ${id}::bigint
    `;
    return row;
  }

  async function itemOf(id: string) {
    const { items } = await adminStore().search({ q: RUN_PREFIX, status: "all", cursor: null, limit: 50 });
    return items.find((item) => item.id === id)!;
  }

  const challengeState = async (challengeId: string) =>
    (await sql`SELECT state, mail_status, failed_attempts FROM update_challenges WHERE id = ${challengeId}::uuid`)[0];

  describe("migration 0005", () => {
    it("starts existing (new/hold/contacted) and new requests without update approval", async () => {
      await insertApplication("fresh");
      const rows = await sql`
        SELECT status, updates_approved, updates_generation::int AS generation, active_installation_id
        FROM access_applications WHERE email LIKE ${`${RUN_PREFIX}legacy-%`} OR email = ${email("fresh")}
        ORDER BY id
      `;
      expect(rows.map((row) => row.status)).toEqual(["new", "hold", "contacted", "new"]);
      for (const row of rows) expect(row).toMatchObject({ updates_approved: false, generation: 0, active_installation_id: null });
    });

    it("enables row level security on the new tables", async () => {
      const tables = await sql`
        SELECT relname FROM pg_class
        WHERE relnamespace = ${schema}::regnamespace AND relkind = 'r' AND relrowsecurity
          AND relname IN ('update_challenges', 'update_installations', 'update_session_nonces', 'update_sessions')
        ORDER BY relname
      `;
      expect(tables.map((row) => row.relname)).toEqual([
        "update_challenges",
        "update_installations",
        "update_session_nonces",
        "update_sessions",
      ]);
    });

    it("lets a request point only at its own installation, and each installation at one request", async () => {
      const a = await registered("fk-a");
      const replaced = a.mac;
      const { body } = await requestCode(newMac(), email("fk-a"));
      const next = newMac();
      await sql`UPDATE update_challenges SET created_at = now() - interval '2 minutes' WHERE application_id = ${a.id}::bigint`;
      const second = await requestCode(next, email("fk-a"));
      expect(body.challengeId).not.toBe(second.body.challengeId);
      expect((await register(next, second.body.challengeId, lastCode())).status).toBe(200);
      const b = await insertApplication("fk-b", { approved: true });
      // Another request's (now inactive) installation: foreign key.
      await expect(
        sql`UPDATE access_applications SET active_installation_id = ${replaced.installationId}::uuid WHERE id = ${b}::bigint`,
      ).rejects.toMatchObject({ code: "23503" });
      // Another request's active installation: unique.
      await expect(
        sql`UPDATE access_applications SET active_installation_id = ${next.installationId}::uuid WHERE id = ${b}::bigint`,
      ).rejects.toMatchObject({ code: "23505" });
    });
  });

  describe("code requests", () => {
    it("mails a code only for an allowed request, to its stored address, and answers everyone alike", async () => {
      await insertApplication("allowed", { approved: true, address: `${RUN_PREFIX}Stored.Case@Example.com` });
      await insertApplication("not-allowed");
      const answers = [];
      for (const address of [
        `  ${RUN_PREFIX}stored.case@example.com `,
        email("not-allowed"),
        email("legacy-contacted"),
        email("never-applied"),
      ]) {
        answers.push(await requestCode(newMac(), address));
      }
      for (const { status, body } of answers) {
        expect(status).toBe(202);
        expect(Object.keys(body).sort()).toEqual(["challengeId", "expiresAt", "ok"]);
        expect(body.challengeId).toMatch(/^[0-9a-f-]{36}$/);
        expect(Date.parse(body.expiresAt) - Date.now()).toBeGreaterThan(9 * 60_000);
      }
      expect(mails).toHaveLength(1);
      expect(mails[0].to).toBe(`${RUN_PREFIX}Stored.Case@Example.com`);
      // No code is stored in clear, and rows for other emails carry no code at all.
      const stored = await sql`SELECT code_hmac, email_key FROM update_challenges WHERE id = ${answers[1].body.challengeId}::uuid`;
      expect(stored[0].code_hmac).toBeNull();
      expect(stored[0].email_key).not.toContain(RUN_PREFIX);
    });

    it("gives a repeated request within a minute the same challenge and no new mail, allowed or not", async () => {
      await insertApplication("repeat", { approved: true });
      const mac = newMac();
      const first = await requestCode(mac, email("repeat"));
      const again = await requestCode(mac, email("repeat"));
      expect(again.body).toEqual(first.body);
      expect(mails).toHaveLength(1);

      const stranger = newMac();
      const a = await requestCode(stranger, email("repeat-unknown"));
      const b = await requestCode(stranger, email("repeat-unknown"));
      expect(b.body).toEqual(a.body);
    });

    it("replaces this installation's earlier code with a new one after the minute", async () => {
      const id = await insertApplication("reissue", { approved: true });
      const mac = newMac();
      const first = await requestCode(mac, email("reissue"));
      const firstCode = lastCode();
      await sql`UPDATE update_challenges SET created_at = now() - interval '61 seconds' WHERE id = ${first.body.challengeId}::uuid`;
      const second = await requestCode(mac, email("reissue"));
      expect(second.body.challengeId).not.toBe(first.body.challengeId);
      expect(mails).toHaveLength(2);
      expect((await challengeState(first.body.challengeId)).state).toBe("void");
      expect((await register(mac, first.body.challengeId, firstCode)).body).toEqual({ ok: false, code: "INVALID_CHALLENGE" });
      expect((await register(mac, second.body.challengeId, lastCode())).status).toBe(200);
      expect((await applicationRow(id)).active).toBe(mac.installationId);
    });

    it("caps codes per email per hour without changing the answer", async () => {
      await insertApplication("capped", { approved: true });
      for (let i = 0; i < CHALLENGES_PER_EMAIL_PER_HOUR; i++) await requestCode(newMac(), email("capped"));
      expect(mails).toHaveLength(CHALLENGES_PER_EMAIL_PER_HOUR);
      const over = await requestCode(newMac(), email("capped"));
      expect(over.status).toBe(202);
      expect(mails).toHaveLength(CHALLENGES_PER_EMAIL_PER_HOUR);
      expect(await sql`SELECT 1 FROM update_challenges WHERE id = ${over.body.challengeId}::uuid`).toHaveLength(0);
    });

    it("leaves the registered Mac and other installations' codes alone when another Mac asks", async () => {
      const a = await registered("ask-only");
      const b = newMac();
      const c = newMac();
      const forB = await requestCode(b, email("ask-only"));
      const codeB = lastCode();
      await requestCode(c, email("ask-only"));
      expect(await authorizer().authorize(a.token)).toMatchObject({ ok: true, installationId: a.mac.installationId });
      expect((await openSession(a.mac)).status).toBe(200);
      expect((await challengeState(forB.body.challengeId)).state).toBe("pending");
      expect((await register(b, forB.body.challengeId, codeB)).status).toBe(200);
    });
  });

  describe("mail failures", () => {
    it("answers 503 and stores nothing when mail access fails, for allowed and unknown emails alike", async () => {
      await insertApplication("no-mail-access", { approved: true });
      mailAccess = false;
      const before = (await sql`SELECT count(*)::int AS n FROM update_challenges`)[0].n;
      for (const address of [email("no-mail-access"), email("no-mail-access-unknown")]) {
        expect((await requestCode(newMac(), address)).status).toBe(503);
      }
      expect((await sql`SELECT count(*)::int AS n FROM update_challenges`)[0].n).toBe(before);
    });

    it("voids a code whose mail was refused and keeps the registered Mac", async () => {
      const a = await registered("refused");
      nextSend = { outcome: "rejected", code: "gmail_send_400_invalidArgument" };
      const b = newMac();
      const { status, body } = await requestCode(b, email("refused"));
      expect(status).toBe(202);
      expect(await challengeState(body.challengeId)).toMatchObject({ state: "void", mail_status: "rejected" });
      expect((await register(b, body.challengeId, lastCode())).body).toEqual({ ok: false, code: "INVALID_CHALLENGE" });
      expect(await authorizer().authorize(a.token)).toMatchObject({ ok: true });
      expect((await applicationRow(a.id)).active).toBe(a.mac.installationId);
    });

    it("records an uncertain mail once, never resends it, and registers nobody by itself", async () => {
      const id = await insertApplication("uncertain", { approved: true });
      nextSend = { outcome: "uncertain", code: "gmail_send_timeout" };
      const mac = newMac();
      const first = await requestCode(mac, email("uncertain"));
      await requestCode(mac, email("uncertain"));
      expect(mails).toHaveLength(1);
      expect(await challengeState(first.body.challengeId)).toMatchObject({ state: "pending", mail_status: "uncertain" });
      expect((await applicationRow(id)).active).toBeNull();
      // If the mail did arrive, its code still works exactly once.
      expect((await register(mac, first.body.challengeId, lastCode())).status).toBe(200);
    });
  });

  describe("registration", () => {
    it("uses a code exactly once and answers INVALID_CHALLENGE for every kind of failure", async () => {
      const id = await insertApplication("once", { approved: true });
      const mac = newMac();
      const { body } = await requestCode(mac, email("once"));
      const code = lastCode();
      expect(await register(mac, body.challengeId, code)).toEqual({ status: 200, body: { ok: true, installationId: mac.installationId } });
      expect(await register(mac, body.challengeId, code)).toEqual({ status: 400, body: { ok: false, code: "INVALID_CHALLENGE" } });
      expect(await applicationRow(id)).toMatchObject({ active: mac.installationId, generation: 1 });
      expect(await challengeState(body.challengeId)).toMatchObject({ state: "used" });
    });

    it("lets only one of two simultaneous uses of the same code succeed", async () => {
      const id = await insertApplication("same-code-race", { approved: true });
      const mac = newMac();
      const { body } = await requestCode(mac, email("same-code-race"));
      const code = lastCode();
      const results = await Promise.all([register(mac, body.challengeId, code, sql), register(mac, body.challengeId, code, other)]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
      expect(await applicationRow(id)).toMatchObject({ active: mac.installationId, generation: 1 });
    });

    it("keeps leading zeros of a code", async () => {
      await insertApplication("zeros", { approved: true });
      const mac = newMac();
      const { body } = await requestCode(mac, email("zeros"));
      await sql`
        UPDATE update_challenges SET code_hmac = ${keyedDigest(SECRET, "code", body.challengeId, "00012345")}
        WHERE id = ${body.challengeId}::uuid
      `;
      expect((await register(mac, body.challengeId, "12345")).status).toBe(400);
      expect((await register(mac, body.challengeId, "00012345")).status).toBe(200);
    });

    it("refuses an expired code", async () => {
      await insertApplication("expired", { approved: true });
      const mac = newMac();
      const { body } = await requestCode(mac, email("expired"));
      await sql`UPDATE update_challenges SET expires_at = now() - interval '1 second' WHERE id = ${body.challengeId}::uuid`;
      expect((await register(mac, body.challengeId, lastCode())).body.code).toBe("INVALID_CHALLENGE");
    });

    it("ends a challenge after five signed wrong codes, but forged attempts use up nothing", async () => {
      await insertApplication("attempts", { approved: true });
      const mac = newMac();
      const { body } = await requestCode(mac, email("attempts"));
      const code = lastCode();
      const wrong = code === "00000000" ? "00000001" : "00000000";
      const forger = newMac(mac.installationId);
      for (let i = 0; i < 10; i++) expect((await register(mac, body.challengeId, wrong, sql, forger)).status).toBe(400);
      expect(await challengeState(body.challengeId)).toMatchObject({ state: "pending", failed_attempts: 0 });
      for (let i = 0; i < 5; i++) expect((await register(mac, body.challengeId, wrong)).status).toBe(400);
      expect(await challengeState(body.challengeId)).toMatchObject({ state: "void", failed_attempts: 5 });
      expect((await register(mac, body.challengeId, code)).status).toBe(400);
    });

    it("binds a code to the installation and key that asked for it", async () => {
      await insertApplication("binding", { approved: true });
      const mac = newMac();
      const { body } = await requestCode(mac, email("binding"));
      const code = lastCode();
      // The code seen in the mail, entered on another Mac (its own id and key).
      expect((await register(newMac(), body.challengeId, code)).status).toBe(400);
      // The right installation id, signed with another key.
      expect((await register(mac, body.challengeId, code, sql, newMac(mac.installationId))).status).toBe(400);
      expect((await register(mac, body.challengeId, code)).status).toBe(200);
    });

    it("never gives an installation id a second key", async () => {
      const a = await registered("one-key");
      const impostor = newMac(a.mac.installationId);
      await sql`UPDATE update_challenges SET created_at = now() - interval '2 minutes'`;
      const { body } = await requestCode(impostor, email("one-key"));
      expect((await register(impostor, body.challengeId, lastCode())).status).toBe(400);
      expect(await challengeState(body.challengeId)).toMatchObject({ state: "void" });
      expect(await authorizer().authorize(a.token)).toMatchObject({ ok: true });
    });

    it("registers only the first of two Macs racing with different codes; the other needs a new code", async () => {
      const id = await insertApplication("two-macs", { approved: true });
      const [a, b] = [newMac(), newMac()];
      const forA = (await requestCode(a, email("two-macs"))).body.challengeId;
      const codeA = lastCode();
      const forB = (await requestCode(b, email("two-macs"))).body.challengeId;
      const codeB = lastCode();
      const results = await Promise.all([register(a, forA, codeA, sql), register(b, forB, codeB, other)]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
      const winner = results[0].status === 200 ? a : b;
      const row = await applicationRow(id);
      expect(row).toMatchObject({ active: winner.installationId, generation: 1 });
      const [{ n }] = await sql`SELECT count(*)::int AS n FROM update_challenges WHERE application_id = ${id}::bigint AND state = 'pending'`;
      expect(n).toBe(0);
    });

    it("moves updates to the new Mac at commit: the old token and session stop at once", async () => {
      const a = await registered("replace");
      const b = newMac();
      const { body } = await requestCode(b, email("replace"));
      expect(await authorizer().authorize(a.token)).toMatchObject({ ok: true });
      expect((await register(b, body.challengeId, lastCode())).status).toBe(200);
      expect(await authorizer().authorize(a.token)).toEqual({ ok: false, status: 403, code: "REGISTRATION_INACTIVE" });
      expect((await openSession(a.mac)).body).toEqual({ ok: false, code: "REGISTRATION_INACTIVE" });
      const bSession = await openSession(b);
      expect(await authorizer().authorize(bSession.body.accessToken)).toMatchObject({ ok: true, installationId: b.installationId });
    });

    it("recovers a lost registration answer with the installation key, not by reusing the code", async () => {
      await insertApplication("lost-answer", { approved: true });
      const mac = newMac();
      const { body } = await requestCode(mac, email("lost-answer"));
      const code = lastCode();
      await register(mac, body.challengeId, code); // answer "lost"
      expect((await register(mac, body.challengeId, code)).status).toBe(400);
      expect((await openSession(mac)).status).toBe(200);
    });
  });

  describe("operator approval", () => {
    it("keeps status, contact time, note, generation and codes when the same value is saved", async () => {
      const id = await insertApplication("same-value", { approved: true });
      const mac = newMac();
      const { body } = await requestCode(mac, email("same-value"));
      const start = await itemOf(id);
      const contacted = await adminStore().update(id, { status: "contacted", operatorNote: "QA", expectedUpdatedAt: start.updatedAt });
      if (contacted.kind !== "updated") throw new Error(contacted.kind);
      const same = await adminStore().update(id, { updatesApproved: true, expectedUpdatedAt: contacted.item.updatedAt });
      if (same.kind !== "updated") throw new Error(same.kind);
      expect(same.item).toMatchObject({ status: "contacted", operatorNote: "QA", updatesApproved: true });
      expect(same.item.lastContactedAt).toBe(contacted.item.lastContactedAt);
      expect((await applicationRow(id)).generation).toBe(0);
      expect((await register(mac, body.challengeId, lastCode())).status).toBe(200);
    });

    it("sends nothing and registers nothing when updates are turned on", async () => {
      const id = await insertApplication("turn-on");
      const start = await itemOf(id);
      expect(start.updatesApproved).toBe(false);
      const on = await adminStore().update(id, { updatesApproved: true, expectedUpdatedAt: start.updatedAt });
      expect(on).toMatchObject({ kind: "updated", item: { updatesApproved: true, status: "new" } });
      expect(mails).toHaveLength(0);
      expect(await applicationRow(id)).toMatchObject({ active: null, generation: 1 });
    });

    it("withdraws everything in one save and needs a new code after approving again", async () => {
      const a = await registered("revoke");
      const pendingMac = newMac();
      const pending = await requestCode(pendingMac, email("revoke"));
      const pendingCode = lastCode();
      const contacted = await adminStore().update(a.id, { status: "contacted", operatorNote: "메모", expectedUpdatedAt: (await itemOf(a.id)).updatedAt });
      if (contacted.kind !== "updated") throw new Error(contacted.kind);

      const off = await adminStore().update(a.id, { updatesApproved: false, expectedUpdatedAt: contacted.item.updatedAt });
      if (off.kind !== "updated") throw new Error(off.kind);
      expect(off.item).toMatchObject({ status: "contacted", operatorNote: "메모", updatesApproved: false });
      expect(off.item.lastContactedAt).toBe(contacted.item.lastContactedAt);
      expect(await authorizer().authorize(a.token)).toEqual({ ok: false, status: 403, code: "REGISTRATION_INACTIVE" });
      expect((await openSession(a.mac)).status).toBe(403);
      expect((await challengeState(pending.body.challengeId)).state).toBe("void");
      expect((await applicationRow(a.id)).active).toBeNull();

      const on = await adminStore().update(a.id, { updatesApproved: true, expectedUpdatedAt: off.item.updatedAt });
      expect(on.kind).toBe("updated");
      expect((await register(pendingMac, pending.body.challengeId, pendingCode)).status).toBe(400);
      expect(await authorizer().authorize(a.token)).toMatchObject({ ok: false, status: 403 });
      expect((await openSession(a.mac)).status).toBe(403);
      await sql`UPDATE update_challenges SET created_at = now() - interval '2 minutes' WHERE application_id = ${a.id}::bigint`;
      const fresh = await requestCode(a.mac, email("revoke"));
      expect((await register(a.mac, fresh.body.challengeId, lastCode())).status).toBe(200);
      expect((await openSession(a.mac)).status).toBe(200);
    });

    it("ends with no active Mac whichever of a withdrawal and a registration commits first", async () => {
      for (let round = 0; round < 3; round++) {
        const id = await insertApplication(`revoke-race-${round}`, { approved: true });
        const mac = newMac();
        const { body } = await requestCode(mac, email(`revoke-race-${round}`));
        const code = lastCode();
        const { updatedAt } = await itemOf(id);
        const [registration, withdrawal] = await Promise.all([
          register(mac, body.challengeId, code, other),
          adminStore().update(id, { updatesApproved: false, expectedUpdatedAt: updatedAt }),
        ]);
        expect(withdrawal.kind).toBe("updated");
        expect([200, 400]).toContain(registration.status);
        expect(await applicationRow(id)).toMatchObject({ updates_approved: false, active: null });
        expect((await openSession(mac)).status).toBe(403);
      }
    });
  });

  describe("sessions and authorization", () => {
    it("accepts each signed nonce once, also when sent twice at the same time", async () => {
      const a = await registered("nonce");
      const nonce = randomBytes(32).toString("base64url");
      const results = await Promise.all([openSession(a.mac, { nonce, client: sql }), openSession(a.mac, { nonce, client: other })]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
      expect((await openSession(a.mac, { nonce })).body).toEqual({ ok: false, code: "INVALID_PROOF" });
    });

    it("answers 403 for an unknown installation", async () => {
      expect((await openSession(newMac())).body).toEqual({ ok: false, code: "REGISTRATION_INACTIVE" });
    });

    it("checks token, expiry, approval, generation and the active Mac on every call", async () => {
      const a = await registered("authorize");
      expect(await authorizer().authorize(a.token)).toMatchObject({ ok: true, installationId: a.mac.installationId });
      expect(await authorizer().authorize(randomBytes(32).toString("base64url"))).toEqual({ ok: false, status: 401, code: "INVALID_TOKEN" });
      expect(await authorizer().authorize("not a token")).toMatchObject({ status: 401 });
      expect(await authorizer().authorize(null)).toMatchObject({ status: 401 });
      await sql`UPDATE update_sessions SET expires_at = now() - interval '1 second' WHERE installation_id = ${a.mac.installationId}::uuid`;
      expect(await authorizer().authorize(a.token)).toMatchObject({ status: 401 });
    });

    it("provides seed and revoke helpers for the package routes' tests", async () => {
      const seeded = await seedRegisteredSession(sql, { email: email("seeded") });
      expect(await authorizer().authorize(seeded.accessToken)).toMatchObject({ ok: true, installationId: seeded.installationId });
      await revokeUpdatesForTest(sql, seeded.applicationId);
      expect(await authorizer().authorize(seeded.accessToken)).toMatchObject({ ok: false, status: 403 });
    });
  });

  it("removes a request's update rows with the request", async () => {
    const a = await registered("delete");
    await sql`DELETE FROM access_applications WHERE id = ${a.id}::bigint`;
    for (const table of ["update_installations", "update_sessions", "update_challenges"]) {
      const [{ n }] = await sql`SELECT count(*)::int AS n FROM ${sql(table)} WHERE application_id = ${a.id}::bigint`;
      expect(n).toBe(0);
    }
  });
});
