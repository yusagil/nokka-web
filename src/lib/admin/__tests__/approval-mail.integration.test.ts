// @vitest-environment node
// Runs against a real Postgres only when APPLICATIONS_TEST_DATABASE_URL is set (a disposable, direct test
// database). Everything happens in a fresh schema that is dropped afterwards. The requests and the installer
// are synthetic; mail goes to an in-memory sender that records each request it would make to Gmail and
// answers as each test scripts it. Nothing leaves the process.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { copyFile, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { applyMigrations } from "../../../../scripts/db-migrate.mjs";
import {
  hashFile,
  initChannel,
  publishPackage,
  rollbackChannel,
  setInstaller,
  stagePackage,
} from "../../../../scripts/update-packages.mjs";
import type { DigestMail, MailSender, SendResult } from "@/lib/notifications/mailer";
import { createInstallSessionHandler } from "@/lib/update-packages/install-handlers";
import { createInstallLinkStore, onceKey } from "@/lib/update-packages/install-links";
import { seedRegisteredSession } from "@/lib/updates/registration/test-support";
import { createAdminApplicationsStore } from "../applications-store";
import { runApprovalMail, type ApprovalMailServices } from "../approval-mail";
import { createApprovalMailRecoveryHandler } from "../approval-mail-cron";
import { createApprovalMailStore, type ApprovalMailStore } from "../approval-mail-store";
import { createApprovalMailHandler, createUpdateHandler, type AdminHandlerOptions } from "../handlers";
import type { AdminSessionResult } from "../session";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const url = process.env.APPLICATIONS_TEST_DATABASE_URL;
const run = randomUUID().replaceAll("-", "").slice(0, 10);
const schema = `nokka_approval_mail_test_${run}`;
const ORIGIN = "http://localhost:3000";
const ADMIN: AdminSessionResult = { ok: true, admin: { githubUserId: "212495406" } };
const BRIDGE = 24;
const CRON_SECRET = `qa-cron-${run}-0123456789`;
const TOKEN_IN_MAIL = new RegExp(`${ORIGIN.replace(/[.:/]/g, "\\$&")}/install#([A-Za-z0-9_-]{43})`);
const sha256 = (value: string) => createHash("sha256").update(value).digest();
/** How a link that downloads once keeps its token: a key derived from the token's SHA-256 (install-links.ts). */
const storedKey = (token: string) => onceKey("token", sha256(token));

describe.skipIf(!url)("approval mail on Postgres", () => {
  let admin: postgres.Sql;
  let sql: postgres.Sql;
  let folder: string;
  // Every mail the in-memory sender was asked to send, and the answers it gives next.
  const outbox: { to: string; mail: DigestMail }[] = [];
  let answers: SendResult[] = [];
  let logs: ReturnType<typeof vi.spyOn>[] = [];

  const sender: MailSender = {
    async authorize() {
      return {
        ok: true,
        async send(to, mail) {
          outbox.push({ to, mail });
          return answers.shift() ?? { outcome: "accepted", messageId: `qa-message-${outbox.length}` };
        },
      };
    },
  };
  const mailServices = (overrides: Partial<ApprovalMailServices> = {}): ApprovalMailServices => ({
    store: createApprovalMailStore(sql),
    sender,
    origin: ORIGIN,
    ...overrides,
  });
  const options = (overrides: Partial<AdminHandlerOptions> = {}): AdminHandlerOptions => ({
    getAdminSession: async () => ADMIN,
    getAllowedOrigin: () => ORIGIN,
    getStore: () => createAdminApplicationsStore(sql),
    getApprovalMail: () => mailServices(),
    ...overrides,
  });
  const adminHeaders = { origin: ORIGIN, "content-type": "application/json", "x-admin-request": "1" };

  const application = async (label: string) => {
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO access_applications (name, email)
      VALUES (${`QA ${label}`}, ${`nokka-approval-qa-${run}-${label}@example.com`})
      RETURNING id::text AS id
    `;
    return row.id;
  };
  const itemOf = async (id: string) => (await createAdminApplicationsStore(sql).get(id))!;
  const patch = async (id: string, body: Record<string, unknown>, overrides: Partial<AdminHandlerOptions> = {}) => {
    const response = await createUpdateHandler(options(overrides))(
      new Request(`${ORIGIN}/api/admin/applications/${id}`, { method: "PATCH", headers: adminHeaders, body: JSON.stringify(body) }),
      { params: Promise.resolve({ id }) },
    );
    return { status: response.status, body: await response.json() };
  };
  const approve = async (id: string, overrides: Partial<AdminHandlerOptions> = {}) =>
    patch(id, { updatesApproved: true, expectedUpdatedAt: (await itemOf(id)).updatedAt }, overrides);
  const sendNow = async (
    id: string,
    expectedMailId: string | null,
    intent: "send" | "resend",
    { headers = adminHeaders, overrides = {} }: { headers?: Record<string, string>; overrides?: Partial<AdminHandlerOptions> } = {},
  ) => {
    const response = await createApprovalMailHandler(options(overrides))(
      new Request(`${ORIGIN}/api/admin/applications/${id}/approval-mail`, {
        method: "POST",
        headers,
        body: JSON.stringify({ expectedMailId, intent }),
      }),
      { params: Promise.resolve({ id }) },
    );
    return { status: response.status, body: await response.json() };
  };
  /** The store-level save, as a PATCH whose function ended right after its commit. */
  const saveApproval = async (id: string, approved: boolean) => {
    const outcome = await createAdminApplicationsStore(sql).update(id, {
      updatesApproved: approved,
      expectedUpdatedAt: (await itemOf(id)).updatedAt,
    });
    if (outcome.kind !== "updated") throw new Error(outcome.kind);
    return outcome.approvalMailId;
  };
  const mails = (id: string) => sql<
    { id: string; trigger: string; state: string; attempts: number; error_code: string | null; link: string | null; started: boolean }[]
  >`
    SELECT id::text AS id, trigger, state, attempts, error_code, install_link_id::text AS link,
           send_started_at IS NOT NULL AS started
    FROM approval_mails WHERE application_id = ${id}::bigint ORDER BY approval_mails.id
  `;
  const links = (id: string) => sql<{ id: string; open: boolean; single: boolean; tokenHash: Buffer }[]>`
    SELECT id::text AS id, revoked_at IS NULL AS open, single_transfer AS single, token_hash AS "tokenHash"
    FROM update_install_links WHERE application_id = ${id}::bigint ORDER BY update_install_links.id
  `;
  const tokenOf = (mail: DigestMail) => {
    const match = TOKEN_IN_MAIL.exec(mail.text);
    expect(match).not.toBeNull();
    return match![1];
  };
  /** Moves a mail's times back past the stale limit, as if its attempt had stopped long ago. */
  const age = (mailId: string) => sql`
    UPDATE approval_mails SET created_at = created_at - interval '10 minutes',
      claimed_at = claimed_at - interval '10 minutes', send_started_at = send_started_at - interval '10 minutes'
    WHERE id = ${mailId}::bigint
  `;
  /** Stores a synthetic package for `build` (verified, chunked) from random bytes. */
  const stage = async (build: number) => {
    const path = join(folder, `Nokka-${build}.dmg`);
    await writeFile(path, randomBytes(100_000));
    const { length, sha256: digest } = await hashFile(path);
    await stagePackage(sql, {
      manifest: {
        format: "nokka-update-package-v1",
        build,
        version: `2.7.${build - BRIDGE}`,
        minimumSystemVersion: "14.0",
        length,
        sha256: digest,
        edSignature: `${randomBytes(64).toString("base64").slice(0, 86)}==`,
        targetCDHash: randomBytes(20).toString("hex"),
        notes: "Synthetic QA package",
      },
      filePath: path,
    });
  };
  const recover = async (budget: { budgetMs?: number; attemptMs?: number; sendMs?: number; now?: () => number } = {}) => {
    const handler = createApprovalMailRecoveryHandler({
      getCronSecret: () => CRON_SECRET,
      getServices: () => mailServices(),
      ...budget,
    });
    const response = await handler(
      new Request(`${ORIGIN}/api/cron/approval-mails`, { headers: { authorization: `Bearer ${CRON_SECRET}` } }),
    );
    return response.json();
  };

  beforeAll(async () => {
    admin = postgres(url!, { max: 1, onnotice: () => {} });
    await admin`CREATE SCHEMA ${admin(schema)}`;
    sql = postgres(url!, { max: 8, prepare: false, onnotice: () => {}, connection: { options: `-c search_path=${schema}` } });
    const [{ current }] = await sql`SELECT current_schema() AS current`;
    if (current !== schema) throw new Error(`Test connection is not isolated (schema: ${current})`);
    folder = await mkdtemp(join(tmpdir(), "nokka-approval-mail-"));

    // Everything up to 0008 first, with a request allowed and a link issued the way the previous version did.
    const before = join(folder, "migrations");
    await (await import("node:fs/promises")).mkdir(before);
    const all = join(process.cwd(), "db/migrations");
    for (const name of (await readdir(all)).filter((file) => file < "0009")) await copyFile(join(all, name), join(before, name));
    expect((await applyMigrations(sql, before)).at(-1)).toBe("0008_install_link_single_use.sql");
    await initChannel(sql, BRIDGE);
    await stage(BRIDGE);
    await setInstaller(sql, BRIDGE);
    const [legacy] = await sql<{ id: string }[]>`
      INSERT INTO access_applications (name, email, updates_approved)
      VALUES ('QA legacy', ${`nokka-approval-qa-${run}-legacy@example.com`}, true) RETURNING id::text AS id
    `;
    await sql`
      INSERT INTO update_install_links (token_hash, ref, application_id, build, expires_at)
      VALUES (${sha256(`legacy-${run}`)}, ${randomUUID()}::uuid, ${legacy.id}::bigint, ${BRIDGE}, now() + interval '1 hour')
    `;
    // Allowed before 0009 too, with a link that was opened and has expired since.
    const [expired] = await sql<{ id: string }[]>`
      INSERT INTO access_applications (name, email, updates_approved)
      VALUES ('QA expired', ${`nokka-approval-qa-${run}-expired@example.com`}, true) RETURNING id::text AS id
    `;
    await sql`
      INSERT INTO update_install_links (token_hash, ref, application_id, build, created_at, expires_at, exchanged_at, session_hash)
      VALUES (${sha256(`expired-${run}`)}, ${randomUUID()}::uuid, ${expired.id}::bigint, ${BRIDGE},
              now() - interval '4 days', now() - interval '1 day', now() - interval '3 days', ${sha256(`expired-session-${run}`)})
    `;
    expect(await applyMigrations(sql)).toEqual(["0009_approval_mail_and_install_button.sql"]);
  });

  afterAll(async () => {
    await sql?.end();
    if (admin) {
      await admin`DROP SCHEMA IF EXISTS ${admin(schema)} CASCADE`;
      await admin.end();
    }
    if (folder) await rm(folder, { recursive: true, force: true });
  });

  beforeEach(() => {
    outbox.length = 0;
    answers = [];
    logs = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    );
  });
  afterEach(() => {
    // Links and addresses go into mails only, never into logs.
    const logged = JSON.stringify(logs.flatMap((spy) => spy.mock.calls));
    for (const { to, mail } of outbox) {
      expect(logged).not.toContain(to);
      expect(logged).not.toContain(tokenOf(mail));
    }
    vi.restoreAllMocks();
  });

  it("stores no mail for requests allowed before 0009, keeps their links' rules and enables row level security", async () => {
    const [{ count }] = await sql`SELECT count(*)::int AS count FROM approval_mails`;
    expect(count).toBe(0);
    const legacy = await sql`SELECT single_transfer, transfer_started_at FROM update_install_links`;
    expect(legacy).toEqual([
      { single_transfer: false, transfer_started_at: null },
      { single_transfer: false, transfer_started_at: null },
    ]);
    const [table] = await sql`
      SELECT relrowsecurity FROM pg_class WHERE relnamespace = ${schema}::regnamespace AND relname = 'approval_mails'
    `;
    expect(table.relrowsecurity).toBe(true);
  });

  it("sends one mail with a new button-only link when the approval is saved, and none for any later save", async () => {
    const id = await application("approve");
    const saved = await approve(id);
    expect(saved.status).toBe(200);
    expect(saved.body.item).toMatchObject({ updatesApproved: true, macRegistered: false, latestCodeMail: null });
    expect(saved.body.item.approvalMail).toMatchObject({ trigger: "approval", status: "accepted", errorCode: null });
    expect(saved.body.item.approvalMail.linkExpiresAt).toMatch(/Z$/);

    expect(outbox).toHaveLength(1);
    expect(outbox[0].to).toBe(`nokka-approval-qa-${run}-approve@example.com`);
    const token = tokenOf(outbox[0].mail);
    // The answer, the list and the database have only the token's SHA-256 and the link's expiry.
    expect(JSON.stringify(saved.body)).not.toContain(token);
    const [link] = await links(id);
    expect(link).toMatchObject({ open: true, single: true });
    expect(link.tokenHash.equals(storedKey(token))).toBe(true);

    // The same value again, a note, a stale retry and two saves at once: no more mail.
    const item = saved.body.item;
    expect((await patch(id, { updatesApproved: true, expectedUpdatedAt: item.updatedAt })).status).toBe(200);
    expect((await patch(id, { operatorNote: "QA", expectedUpdatedAt: (await itemOf(id)).updatedAt })).status).toBe(200);
    expect(await patch(id, { updatesApproved: true, expectedUpdatedAt: item.updatedAt })).toMatchObject({ status: 409 });
    const other = await application("approve-twice");
    const expected = (await itemOf(other)).updatedAt;
    const both = await Promise.all([0, 1].map(() => patch(other, { updatesApproved: true, expectedUpdatedAt: expected })));
    expect(both.map((answer) => answer.status).sort()).toEqual([200, 409]);
    expect(outbox).toHaveLength(2);
    expect(await mails(id)).toHaveLength(1);
    expect(await mails(other)).toHaveLength(1);

    // Opening the mail's link: a page that opens links as it loads uses nothing; the button opens it once.
    const open = (body: Record<string, string>) =>
      createInstallSessionHandler({ getLinkStore: () => createInstallLinkStore(sql) })(
        new Request(`${ORIGIN}/api/updates/v1/install/session`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
    expect((await open({ token })).status).toBe(409);
    expect((await itemOf(id)).approvalMail!.linkState).toBe("open");
    expect((await open({ token, action: "download" })).status).toBe(200);
    expect((await open({ token, action: "download" })).status).toBe(410);

    // The card reads the link as it goes: downloaded once its one transfer starts, expired, closed.
    expect(await createInstallLinkStore(sql).startTransfer(link.id)).toEqual({ kind: "started" });
    expect((await itemOf(id)).approvalMail!.linkState).toBe("downloaded");
    const otherLink = (await links(other))[0];
    await sql`
      UPDATE update_install_links SET created_at = now() - interval '4 days', expires_at = now() - interval '1 day'
      WHERE id = ${otherLink.id}::bigint
    `;
    expect((await itemOf(other)).approvalMail!.linkState).toBe("expired");
    await createInstallLinkStore(sql).revoke(other);
    expect((await itemOf(other)).approvalMail!.linkState).toBe("closed");
  });

  it("keeps the approval and sends nothing without an installer, then sends it once the operator asks", async () => {
    const id = await application("no-installer");
    await setInstaller(sql, null);
    try {
      const saved = await approve(id);
      expect(saved.status).toBe(200);
      expect(saved.body.item.updatesApproved).toBe(true);
      expect(saved.body.item.approvalMail).toMatchObject({ status: "failed", errorCode: "no_installer", sendStartedAt: null });
      expect(outbox).toHaveLength(0);
      expect(await links(id)).toEqual([]);
    } finally {
      await setInstaller(sql, BRIDGE);
    }
    const failed = (await itemOf(id)).approvalMail!;
    const sent = await sendNow(id, failed.id, "resend");
    expect(sent.status).toBe(200);
    expect(sent.body.item.approvalMail).toMatchObject({ trigger: "manual", status: "accepted" });
    expect(outbox).toHaveLength(1);
    // A second press with what the card showed before is refused: no second mail.
    expect(await sendNow(id, failed.id, "resend")).toMatchObject({ status: 409, body: { ok: false, code: "CONFLICT" } });
    expect(outbox).toHaveLength(1);
  });

  it("cancels a mail not yet sent when the approval is withdrawn, and sends a new one when it is given again", async () => {
    const id = await application("withdraw");
    const first = (await saveApproval(id, true))!;
    await saveApproval(id, false);
    expect(await mails(id)).toEqual([expect.objectContaining({ id: first, state: "cancelled", error_code: "approval_withdrawn" })]);
    expect(await createApprovalMailStore(sql).claim(first)).toBeNull();
    expect(await sendNow(id, first, "resend")).toMatchObject({ status: 409, body: { code: "UPDATES_NOT_APPROVED" } });

    const again = await approve(id);
    expect(again.body.item.approvalMail).toMatchObject({ trigger: "approval", status: "accepted" });
    expect(again.body.item.approvalMail.id).not.toBe(first);
    expect(outbox).toHaveLength(1);
  });

  it("lets a stalled attempt of an earlier approval send nothing and close nothing", async () => {
    const id = await application("stalled");
    const store = createApprovalMailStore(sql);
    // Attempt A stalls before its link; attempt B after its link, before it records the start.
    const early = (await saveApproval(id, true))!;
    const stalledBeforeLink = (await store.claim(early))!;
    await saveApproval(id, false);
    await saveApproval(id, true);
    const [, second] = await mails(id);
    const stalledAfterLink = (await store.claim(second.id))!;
    expect(await store.prepare(stalledAfterLink, { tokenHash: sha256(`b-${run}`), ttlSeconds: 3600 })).toMatchObject({ kind: "ready" });
    await saveApproval(id, false);
    await saveApproval(id, true);
    const [, , third] = await mails(id);
    await runApprovalMail((await store.claim(third.id))!, mailServices());
    expect(outbox).toHaveLength(1);
    const current = (await links(id)).filter((link) => link.open);
    expect(current).toHaveLength(1);
    expect(current[0].tokenHash.equals(storedKey(tokenOf(outbox[0].mail)))).toBe(true);

    // Both resume now: neither issues, sends or closes anything.
    await runApprovalMail(stalledBeforeLink, mailServices());
    expect(await store.markSending(stalledAfterLink)).toBe(false);
    expect(outbox).toHaveLength(1);
    expect((await links(id)).filter((link) => link.open).map((link) => link.id)).toEqual(current.map((link) => link.id));
    expect((await mails(id)).map((mail) => mail.state)).toEqual(["cancelled", "cancelled", "accepted"]);
  });

  it("keeps a link made by hand when a mail of the same approval resumes after it", async () => {
    const id = await application("by-hand");
    const store = createApprovalMailStore(sql);
    const mailId = (await saveApproval(id, true))!;
    const stalled = (await store.claim(mailId))!;
    const handMade = await createInstallLinkStore(sql).issue(id, { tokenHash: sha256(`hand-${run}`), ttlSeconds: 3600 });
    expect(handMade.kind).toBe("issued");
    await runApprovalMail(stalled, mailServices());
    expect(outbox).toHaveLength(0);
    const open = (await links(id)).filter((link) => link.open);
    expect(open).toHaveLength(1);
    expect(open[0].tokenHash.equals(storedKey(`hand-${run}`))).toBe(true);
    expect(await mails(id)).toEqual([expect.objectContaining({ state: "cancelled", error_code: "replaced_by_operator_link" })]);
  });

  it("sends a mail whose save ended before it was claimed, or whose attempt stopped before asking, once", async () => {
    const unclaimed = await application("unclaimed");
    const unclaimedMail = (await saveApproval(unclaimed, true))!;
    const stopped = await application("stopped");
    const stoppedMail = (await saveApproval(stopped, true))!;
    const stale = (await createApprovalMailStore(sql).claim(stoppedMail))!;

    // Fresh: still the save's own to send.
    expect(await recover()).toEqual({ ok: true, attempted: 0 });
    expect((await itemOf(unclaimed)).approvalMail!.status).toBe("queued");
    await age(unclaimedMail);
    await age(stoppedMail);
    expect((await itemOf(stopped)).approvalMail!.status).toBe("interrupted");

    expect(await recover()).toEqual({ ok: true, attempted: 2 });
    expect(outbox.map(({ to }) => to).sort()).toEqual(
      [`nokka-approval-qa-${run}-stopped@example.com`, `nokka-approval-qa-${run}-unclaimed@example.com`],
    );
    expect(await recover()).toEqual({ ok: true, attempted: 0 });
    // The stopped attempt can not write over the one that sent it.
    await createApprovalMailStore(sql).fail(stale, "internal_error");
    expect(await mails(stopped)).toEqual([expect.objectContaining({ state: "accepted", attempts: 2 })]);
    expect(outbox).toHaveLength(2);
  });

  it("never asks again by itself once the start is recorded, and only the operator sends a new mail", async () => {
    // A: the function ended right after recording the start. B: the mail service took it, the answer was lost.
    const endedAfterStart = await application("ended-after-start");
    const lostAnswer = await application("lost-answer");
    const store = createApprovalMailStore(sql);
    const a = (await store.claim((await saveApproval(endedAfterStart, true))!))!;
    expect(await store.prepare(a, { tokenHash: sha256(`a-${run}`), ttlSeconds: 3600 })).toMatchObject({ kind: "ready" });
    expect(await store.markSending(a)).toBe(true);

    const losing: ApprovalMailStore = {
      ...store,
      finish: async () => {
        throw Object.assign(new Error("connection lost"), { code: "ECONNRESET" });
      },
    };
    const lostMail = (await saveApproval(lostAnswer, true))!;
    const b = (await store.claim(lostMail))!;
    await runApprovalMail(b, mailServices({ store: losing }));
    expect(outbox).toHaveLength(1);
    const firstLostToken = tokenOf(outbox[0].mail);

    await age(a.id);
    await age(lostMail);
    for (const id of [endedAfterStart, lostAnswer]) {
      expect((await itemOf(id)).approvalMail).toMatchObject({ status: "uncertain", errorCode: "result_not_recorded" });
    }
    expect(await recover()).toEqual({ ok: true, attempted: 0 });
    expect(outbox).toHaveLength(1);

    // The operator sends B again: a new mail with a new link, and the link in the lost one closes.
    const again = await sendNow(lostAnswer, lostMail, "resend");
    expect(again.body.item.approvalMail).toMatchObject({ trigger: "manual", status: "accepted" });
    expect(outbox).toHaveLength(2);
    const open = (await links(lostAnswer)).filter((link) => link.open);
    expect(open).toHaveLength(1);
    expect(open[0].tokenHash.equals(storedKey(tokenOf(outbox[1].mail)))).toBe(true);
    expect(open[0].tokenHash.equals(storedKey(firstLostToken))).toBe(false);
    // The lost answer, recorded late, lands on its own mail only.
    await store.finish(b, { outcome: "accepted", messageId: "qa-late" });
    expect((await mails(lostAnswer)).map((mail) => mail.state)).toEqual(["accepted", "accepted"]);
  });

  it("closes the link of a refused mail, keeps an uncertain one without repeating it, and lets the operator send again", async () => {
    const refused = await application("refused");
    answers = [{ outcome: "rejected", code: "gmail_send_400_invalidArgument" }];
    expect((await approve(refused)).body.item.approvalMail).toMatchObject({
      status: "rejected",
      errorCode: "gmail_send_400_invalidArgument",
    });
    expect(await links(refused)).toEqual([expect.objectContaining({ open: false })]);

    const uncertain = await application("uncertain");
    answers = [{ outcome: "uncertain", code: "gmail_send_timeout" }];
    const saved = await approve(uncertain);
    expect(saved.body.item.approvalMail).toMatchObject({ status: "uncertain", errorCode: "gmail_send_timeout" });
    expect(await links(uncertain)).toEqual([expect.objectContaining({ open: true })]);
    await age(saved.body.item.approvalMail.id);
    expect(await recover()).toEqual({ ok: true, attempted: 0 });
    expect(outbox).toHaveLength(2);

    expect((await sendNow(refused, (await itemOf(refused)).approvalMail!.id, "resend")).body.item.approvalMail.status).toBe("accepted");
    expect((await sendNow(uncertain, saved.body.item.approvalMail.id, "resend")).body.item.approvalMail.status).toBe("accepted");
    expect(outbox).toHaveLength(4);
    expect((await links(uncertain)).map((link) => link.open)).toEqual([false, true]);
  });

  it("sends one mail for two presses at once, and answers MAIL_IN_PROGRESS while one is being sent", async () => {
    const id = await application("presses");
    const mailId = (await saveApproval(id, true))!;
    const presses = await Promise.all([0, 1].map(() => sendNow(id, mailId, "send")));
    expect(presses.map((press) => press.status).sort()).toEqual([200, 409]);
    expect(outbox).toHaveLength(1);

    const busy = await application("busy");
    const busyMail = (await saveApproval(busy, true))!;
    const busyClaim = (await createApprovalMailStore(sql).claim(busyMail))!;
    expect(await sendNow(busy, busyMail, "send")).toMatchObject({ status: 409, body: { code: "MAIL_IN_PROGRESS" } });
    expect(outbox).toHaveLength(1);
    // Ends here, so a slow run never finds it left behind in a later test.
    await createApprovalMailStore(sql).fail(busyClaim, "internal_error");
  });

  it("changes no mail and no link for a request without the admin session or from another origin", async () => {
    const id = await application("guarded");
    await approve(id);
    const before = { mails: await mails(id), links: await links(id) };
    const refused = [
      await sendNow(id, before.mails[0].id, "resend", { overrides: { getAdminSession: async () => ({ ok: false, status: 401, code: "UNAUTHENTICATED" }) } }),
      await sendNow(id, before.mails[0].id, "resend", { headers: { ...adminHeaders, origin: "https://evil.example" } }),
      await sendNow(id, before.mails[0].id, "resend", { headers: { origin: ORIGIN, "content-type": "application/json" } }),
    ];
    expect(refused.map((answer) => answer.status)).toEqual([401, 403, 403]);
    expect(await mails(id)).toEqual(before.mails);
    expect(await links(id)).toEqual(before.links);
    expect(outbox).toHaveLength(1);
  });

  it("shows whether a Mac is registered and the latest code mail, never the code, key or installation", async () => {
    const email = `nokka-approval-qa-${run}-registered@example.com`;
    const { installationId } = await seedRegisteredSession(sql, { email });
    const [row] = await sql<{ id: string }[]>`SELECT id::text AS id FROM access_applications WHERE email = ${email}`;
    const item = await itemOf(row.id);
    expect(item).toMatchObject({ macRegistered: true, latestCodeMail: { status: "pending" }, approvalMail: null });
    expect(item.latestCodeMail!.requestedAt).toMatch(/Z$/);
    const { items } = await createAdminApplicationsStore(sql).search({ q: email, status: "all", cursor: null, limit: 5 });
    expect(items).toEqual([item]);
    expect(JSON.stringify(items)).not.toContain(installationId);
    const [{ code }] = await sql`SELECT code_hmac AS code FROM update_challenges WHERE application_id = ${row.id}::bigint LIMIT 1`;
    expect(JSON.stringify(items)).not.toContain(code);
  });

  it("keeps a link the operator revoked closed: the mail that prepared it sends nothing and is never claimed again", async () => {
    // Prepared (link issued), then the operator revokes, then the attempt resumes.
    const prepared = await application("revoked-after-link");
    const store = createApprovalMailStore(sql);
    const preparedMail = (await saveApproval(prepared, true))!;
    const claim = (await store.claim(preparedMail))!;
    expect(await store.prepare(claim, { tokenHash: sha256(`r-${run}`), ttlSeconds: 3600 })).toMatchObject({ kind: "ready" });
    expect(await createInstallLinkStore(sql).revoke(prepared)).toEqual({ kind: "revoked", revoked: 1 });
    expect(await store.markSending(claim)).toBe(false);
    // Waiting (never claimed) when the operator revokes.
    const waiting = await application("revoked-while-waiting");
    const waitingMail = (await saveApproval(waiting, true))!;
    expect(await createInstallLinkStore(sql).revoke(waiting)).toEqual({ kind: "revoked", revoked: 0 });

    await age(preparedMail);
    await age(waitingMail);
    expect(await recover()).toEqual({ ok: true, attempted: 0 });
    expect(outbox).toHaveLength(0);
    for (const id of [prepared, waiting]) {
      expect((await links(id)).filter((link) => link.open)).toEqual([]);
      expect((await mails(id)).map((mail) => mail.state)).toEqual(["cancelled"]);
      expect((await itemOf(id)).approvalMail!.status).toBe("cancelled");
    }
    // Only the operator's own request sends a new link.
    expect((await sendNow(prepared, preparedMail, "resend")).body.item.approvalMail.status).toBe("accepted");
    expect(outbox).toHaveLength(1);
  });

  it("reads the latest mail by its number, also across a digit boundary", async () => {
    const id = await application("digits");
    await saveApproval(id, true);
    const [{ generation }] = await sql`SELECT updates_generation::text AS generation FROM access_applications WHERE id = ${id}::bigint`;
    await sql`DELETE FROM approval_mails WHERE application_id = ${id}::bigint`;
    // Mails 999999 and 1000000 of the same request: as text, "999999" sorts after "1000000".
    for (const mailId of [999999, 1000000]) {
      await sql`
        INSERT INTO approval_mails (id, application_id, generation, trigger, state, error_code, finished_at)
        OVERRIDING SYSTEM VALUE
        VALUES (${mailId}, ${id}::bigint, ${generation}::bigint, 'manual', 'cancelled', 'superseded', now())
      `;
    }
    await sql`SELECT setval(pg_get_serial_sequence('approval_mails', 'id'), 1000000)`;
    expect((await itemOf(id)).approvalMail!.id).toBe("1000000");
    expect(await sendNow(id, "999999", "resend")).toMatchObject({ status: 409, body: { code: "CONFLICT" } });
    const sent = await sendNow(id, "1000000", "resend");
    expect(sent.status).toBe(200);
    expect(sent.body.item.approvalMail).toMatchObject({ trigger: "manual", status: "accepted" });
    expect(Number(sent.body.item.approvalMail.id)).toBeGreaterThan(1000000);
    expect(outbox).toHaveLength(1);
  });

  it("sends a waiting mail once however often a card that showed it waiting asks", async () => {
    // The answer was lost and the same request comes again.
    const repeated = await application("repeated-send");
    const repeatedMail = (await saveApproval(repeated, true))!;
    expect((await sendNow(repeated, repeatedMail, "send")).body.item.approvalMail.status).toBe("accepted");
    expect(await sendNow(repeated, repeatedMail, "send")).toMatchObject({ status: 409, body: { code: "CONFLICT" } });
    // A card that showed it waiting while the recovery run sent it.
    const late = await application("late-card");
    const lateMail = (await saveApproval(late, true))!;
    await age(lateMail);
    expect(await recover()).toEqual({ ok: true, attempted: 1 });
    expect(await sendNow(late, lateMail, "send")).toMatchObject({ status: 409, body: { code: "CONFLICT" } });

    expect(outbox).toHaveLength(2);
    for (const id of [repeated, late]) {
      const open = (await links(id)).filter((link) => link.open);
      expect(open).toHaveLength(1);
      const mailed = outbox.find(({ to }) => to.includes(id === repeated ? "repeated-send" : "late-card"))!;
      expect(open[0].tokenHash.equals(storedKey(tokenOf(mailed.mail)))).toBe(true);
      expect(await mails(id)).toHaveLength(1);
    }
    // Only a card that shows the mail as sent sends it again, with a new link that closes the first.
    expect((await itemOf(late)).approvalMail!.status).toBe("accepted");
    expect((await sendNow(late, lateMail, "resend")).body.item.approvalMail.trigger).toBe("manual");
    expect(outbox).toHaveLength(3);
    expect((await links(late)).map((link) => link.open)).toEqual([false, true]);
  });

  it("sends nothing when the installer is withdrawn after the link was made, and lets the operator send again", async () => {
    // A published build is the installer; its link is made, then the build is rolled back (withdrawn).
    await stage(BRIDGE + 1);
    await publishPackage(sql, BRIDGE + 1, null);
    await setInstaller(sql, BRIDGE + 1);
    const id = await application("withdrawn-build");
    const store = createApprovalMailStore(sql);
    let claim;
    try {
      claim = (await store.claim((await saveApproval(id, true))!))!;
      expect(await store.prepare(claim, { tokenHash: sha256(`w-${run}`), ttlSeconds: 3600 })).toMatchObject({
        kind: "ready",
        link: { build: BRIDGE + 1 },
      });
      expect(await rollbackChannel(sql, { to: null, expectCurrent: BRIDGE + 1 })).toEqual({ installerCleared: true });
      expect(await store.markSending(claim)).toBe(false);
    } finally {
      await setInstaller(sql, BRIDGE);
    }
    expect(outbox).toHaveLength(0);
    const item = await itemOf(id);
    expect(item.updatesApproved).toBe(true);
    expect(item.approvalMail).toMatchObject({ status: "failed", errorCode: "installer_withdrawn", sendStartedAt: null });
    // Not claimed again by the recovery run; the operator sends it with the installer set now.
    await age(item.approvalMail!.id);
    expect(await recover()).toEqual({ ok: true, attempted: 0 });
    const again = await sendNow(id, item.approvalMail!.id, "resend");
    expect(again.body.item.approvalMail).toMatchObject({ trigger: "manual", status: "accepted" });
    expect(outbox).toHaveLength(1);
    const [link] = await sql`
      SELECT build FROM update_install_links WHERE token_hash = ${storedKey(tokenOf(outbox[0].mail))}
    `;
    expect(link.build).toBe(BRIDGE);
  });

  it("claims only the mails one call has time to send, and leaves the rest for the next call", async () => {
    // Anything else left behind goes first, so only these three are left.
    await recover();
    const ids = [await application("budget-a"), await application("budget-b"), await application("budget-c")];
    const mailIds = [];
    for (const id of ids) mailIds.push((await saveApproval(id, true))!);
    for (const mailId of mailIds) await age(mailId);

    // A clock that moves 10 s at every reading (before each attempt and once it holds its rows): with 70 s,
    // 25 s per attempt and 10 s per send, the attempts start at 10 s and 30 s; one at 50 s would not fit.
    let clock = 0;
    const now = () => {
      const at = clock;
      clock += 10_000;
      return at;
    };
    expect(await recover({ budgetMs: 70_000, attemptMs: 25_000, sendMs: 10_000, now })).toEqual({ ok: true, attempted: 2 });
    const states = [];
    for (const id of ids) states.push((await mails(id))[0].state);
    expect(states.sort()).toEqual(["accepted", "accepted", "queued"]);
    expect(outbox).toHaveLength(2);
    // The one left was never claimed: the next call takes it at once.
    expect(await recover()).toEqual({ ok: true, attempted: 1 });
    expect(outbox).toHaveLength(3);
  });

  it("sends a request allowed before approval mails its first mail with a new link, once, when the operator asks", async () => {
    const byEmail = async (label: string) => {
      const [row] = await sql<{ id: string }[]>`
        SELECT id::text AS id FROM access_applications WHERE email = ${`nokka-approval-qa-${run}-${label}@example.com`}
      `;
      return row.id;
    };
    for (const label of ["legacy", "expired"]) {
      const id = await byEmail(label);
      const before = await itemOf(id);
      expect(before).toMatchObject({ updatesApproved: true, approvalMail: null });
      const sent = await sendNow(id, null, "send");
      expect(sent.status).toBe(200);
      expect(sent.body.item.approvalMail).toMatchObject({ trigger: "manual", status: "accepted" });
      expect(sent.body.item.updatedAt).toBe(before.updatedAt);
      const mailed = outbox.at(-1)!;
      expect(mailed.to).toBe(`nokka-approval-qa-${run}-${label}@example.com`);
      // The old link is closed; the one in the mail is new and downloads once.
      const all = await links(id);
      expect(all.map((link) => [link.open, link.single])).toEqual([
        [false, false],
        [true, true],
      ]);
      expect(all[1].tokenHash.equals(storedKey(tokenOf(mailed.mail)))).toBe(true);
      // The same request again (a second press, another tab): nothing more.
      expect(await sendNow(id, null, "send")).toMatchObject({ status: 409, body: { code: "CONFLICT" } });
    }
    expect(outbox).toHaveLength(2);
  });

  it("hands a mail back unsent when its attempt waited for the rows until the send no longer fits", async () => {
    await recover();
    outbox.length = 0;
    const id = await application("late-lock");
    const mailId = (await saveApproval(id, true))!;
    await age(mailId);

    // Another transaction holds the channel row (as the release tool does) past this call's deadline.
    const holder = postgres(url!, { max: 1, prepare: false, onnotice: () => {}, connection: { options: `-c search_path=${schema}` } });
    let late: Promise<unknown> | null = null;
    try {
      await holder.begin(async (tx) => {
        await tx`SELECT 1 FROM update_channel WHERE id FOR UPDATE`;
        late = recover({ budgetMs: 1500, attemptMs: 300, sendMs: 300 });
        for (let tries = 0; ; tries++) {
          const [{ count }] = await admin<{ count: number }[]>`
            SELECT count(*)::int AS count FROM pg_stat_activity
            WHERE datname = current_database() AND cardinality(pg_blocking_pids(pid)) > 0
          `;
          if (count > 0) break;
          if (tries > 400) throw new Error("the attempt never waited for the channel row");
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        await new Promise((resolve) => setTimeout(resolve, 1800));
      });
    } finally {
      await holder.end();
    }
    expect(await late).toEqual({ ok: true, attempted: 1 });
    // Never asked, no start recorded: waiting again and claimable at once.
    expect(outbox).toHaveLength(0);
    expect(await mails(id)).toEqual([expect.objectContaining({ state: "queued", started: false, attempts: 1 })]);
    expect((await itemOf(id)).approvalMail!.status).not.toBe("uncertain");

    expect(await recover()).toEqual({ ok: true, attempted: 1 });
    expect(outbox).toHaveLength(1);
    expect(await mails(id)).toEqual([expect.objectContaining({ state: "accepted", attempts: 2 })]);
    const open = (await links(id)).filter((link) => link.open);
    expect(open).toHaveLength(1);
    expect(open[0].tokenHash.equals(storedKey(tokenOf(outbox[0].mail)))).toBe(true);
  });
});
