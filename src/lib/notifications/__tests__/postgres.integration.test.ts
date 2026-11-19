// @vitest-environment node
// Runs against a real Postgres only when APPLICATIONS_TEST_DATABASE_URL is set (a direct, non-pooled
// test database). Everything happens in a fresh schema that is dropped afterwards; use synthetic
// data only and never point this at the production list. No mail leaves the process: the provider
// is an in-memory Gmail fake (no idempotency key, like Gmail), and global fetch fails the test.
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, it, expect, vi } from "vitest";
import { applyMigrations } from "../../../../scripts/db-migrate.mjs";
import { createApplicationStore } from "../../applications/store";
import { createDigestStore, type DigestStore } from "../digest-store";
import { createApplicationDigestHandler } from "../handler";
import type { DigestMail, DigestMailer, SendResult } from "../mailer";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const url = process.env.APPLICATIONS_TEST_DATABASE_URL;
const run = randomUUID().replaceAll("-", "").slice(0, 10);
const schema = `nokka_digest_test_${run}`;
const SECRET = "integration-cron-secret-0123456789";
const REPEAT_WARNING = "digest sent again after an uncertain send; the admin may get it twice";
const email = (label: string) => `nokka-digest-qa-${run}-${label}@example.com`;

/** deliver; reject (refused, not sent); lose_response (delivered, answer lost); fail_before (not delivered). */
type Send = "deliver" | "reject" | "lose_response" | "fail_before";

/** Gmail-like fake: every accepted send is a delivered mail; there is no deduplication. */
function fakeGmail({ delayMs = 0 } = {}) {
  const delivered: DigestMail[] = [];
  const sends: Send[] = [];
  const tokens: string[] = [];
  let sendCount = 0;
  let authorizeCount = 0;
  const mailer: DigestMailer = {
    async authorize() {
      authorizeCount++;
      const tokenError = tokens.shift();
      if (tokenError) return { ok: false, code: tokenError };
      return {
        ok: true,
        async send(mail): Promise<SendResult> {
          sendCount++;
          if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
          const behaviour = sends.shift() ?? "deliver";
          if (behaviour === "reject") return { outcome: "rejected", code: "gmail_send_403_dailyLimitExceeded" };
          if (behaviour === "fail_before") return { outcome: "uncertain", code: "gmail_send_network" };
          delivered.push(mail);
          if (behaviour === "lose_response") return { outcome: "uncertain", code: "gmail_send_timeout" };
          return { outcome: "accepted", messageId: randomUUID().replaceAll("-", "").slice(0, 16) };
        },
      };
    },
  };
  return { mailer, delivered, sends, tokens, sendCount: () => sendCount, authorizeCount: () => authorizeCount };
}

describe.skipIf(!url)("application digest on Postgres", () => {
  let admin: postgres.Sql;
  let sql: postgres.Sql;
  const networkFetch = vi.fn(() => Promise.reject(new Error("real network is disabled in tests")));

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
    expect(await applyMigrations(sql)).toEqual([
      "0001_access_applications.sql",
      "0002_admin_inbox.sql",
      "0003_application_digest.sql",
    ]);
  });

  afterAll(async () => {
    await sql?.end();
    if (admin) {
      await admin`DROP SCHEMA IF EXISTS ${admin(schema)} CASCADE`;
      await admin.end();
    }
  });

  let errors: ReturnType<typeof vi.spyOn>;
  let warnings: ReturnType<typeof vi.spyOn>;
  beforeEach(async () => {
    await sql`TRUNCATE application_digest_items, application_digest_runs, access_applications RESTART IDENTITY`;
    errors = vi.spyOn(console, "error").mockImplementation(() => {});
    warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", networkFetch);
  });
  afterEach(() => {
    expect(networkFetch).not.toHaveBeenCalled();
    errors.mockRestore();
    warnings.mockRestore();
    vi.unstubAllGlobals();
  });

  const cron = async (
    mailer: DigestMailer,
    store: DigestStore = createDigestStore(sql),
    authorization = `Bearer ${SECRET}`,
  ) => {
    const handler = createApplicationDigestHandler({
      getCronSecret: () => SECRET,
      getServices: () => ({ store, mailer }),
    });
    const response = await handler(
      new Request("http://localhost/api/cron/application-digest", { headers: { authorization } }),
    );
    return { status: response.status, body: await response.json() };
  };
  const sent = (count: number) => ({ status: 200, body: { ok: true, status: "sent", count } });
  const skipped = { status: 200, body: { ok: true, status: "skipped", count: 0 } };
  const unavailable = { status: 503, body: { ok: false, code: "UNAVAILABLE" } };
  const apply = async (...labels: string[]) => {
    const store = createApplicationStore(sql);
    for (const label of labels) await store.save({ name: `QA 요약 ${label}`, email: email(label) });
  };
  const runs = () => sql`
    SELECT id, status, application_count, attempts, error_code, provider_message_id, lease_expires_at,
           sent_at, last_attempted_at, idempotency_key, idempotency_key_used_at
    FROM application_digest_runs ORDER BY created_at, id
  `;
  const unassigned = async () => {
    const [{ count }] = await sql`
      SELECT count(*)::int AS count FROM access_applications a
      WHERE NOT EXISTS (SELECT 1 FROM application_digest_items i WHERE i.application_id = a.id)
    `;
    return count as number;
  };
  const batchItems = async (runId: string) =>
    (await sql`SELECT application_id FROM application_digest_items WHERE run_id = ${runId} ORDER BY application_id`).map(
      (row) => row.application_id as string,
    );
  /** Moves every send and send attempt to the previous day (Asia/Seoul), as if the next cron day came. */
  const nextDay = () => sql`
    UPDATE application_digest_runs
    SET sent_at = sent_at - interval '1 day',
        first_attempted_at = first_attempted_at - interval '1 day',
        last_attempted_at = last_attempted_at - interval '1 day'
  `;
  const expireLease = () => sql`
    UPDATE application_digest_runs SET lease_expires_at = now() - interval '1 second' WHERE status = 'sending'
  `;
  const applicantRows = () => sql`
    SELECT id, name, email, created_at, status, operator_note, last_contacted_at, updated_at
    FROM access_applications ORDER BY id
  `;
  const failingMarkSent = (): DigestStore => ({
    ...createDigestStore(sql),
    markSent: async () => {
      throw Object.assign(new Error("connection lost"), { code: "ECONNRESET" });
    },
  });

  describe("migration", () => {
    it("enables row level security on the digest tables", async () => {
      const tables = await sql`
        SELECT relname, relrowsecurity FROM pg_class
        WHERE relnamespace = ${schema}::regnamespace
          AND relname IN ('application_digest_runs', 'application_digest_items')
        ORDER BY relname
      `;
      expect(tables.map((row) => [row.relname, row.relrowsecurity])).toEqual([
        ["application_digest_items", true],
        ["application_digest_runs", true],
      ]);
    });

    it("allows only one unfinished batch and keeps the lease and sent columns consistent", async () => {
      await sql`INSERT INTO application_digest_runs (id, status, application_count) VALUES (${randomUUID()}, 'failed', 1)`;
      await expect(
        sql`INSERT INTO application_digest_runs (id, status, application_count) VALUES (${randomUUID()}, 'unknown', 1)`,
      ).rejects.toMatchObject({ code: "23505" });
      await expect(
        sql`INSERT INTO application_digest_runs (id, status, application_count) VALUES (${randomUUID()}, 'sent', 1)`,
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        sql`INSERT INTO application_digest_runs (id, status, application_count, lease_expires_at)
            VALUES (${randomUUID()}, 'skipped', 0, now())`,
      ).rejects.toMatchObject({ code: "23514" });
    });
  });

  it("rejects calls without the cron secret and writes nothing", async () => {
    await apply("auth");
    const gmail = fakeGmail();
    expect(await cron(gmail.mailer, undefined, "Bearer nope-nope-nope-nope")).toEqual({
      status: 401,
      body: { ok: false, code: "UNAUTHENTICATED" },
    });
    expect(await runs()).toEqual([]);
    expect(gmail.authorizeCount()).toBe(0);
  });

  it("records a skipped day without touching the mail account when there is nothing new", async () => {
    const gmail = fakeGmail();
    expect(await cron(gmail.mailer)).toEqual(skipped);
    const [row, ...rest] = await runs();
    expect(rest).toEqual([]);
    expect(row).toMatchObject({ status: "skipped", application_count: 0, attempts: 0, last_attempted_at: null });
    expect(gmail.authorizeCount()).toBe(0);
  });

  it("sends one count-only digest a day; duplicates do not count and later requests wait a day", async () => {
    await apply("a", "b", "c");
    const store = createApplicationStore(sql);
    expect(await store.save({ name: "QA 다시", email: ` ${email("a").toUpperCase()} ` })).toBe("existing");
    expect(await store.save({ name: "QA 다시", email: email("b") })).toBe("existing");
    const before = await applicantRows();

    const gmail = fakeGmail();
    expect(await cron(gmail.mailer)).toEqual(sent(3));
    expect(gmail.delivered).toHaveLength(1);
    const [mail] = gmail.delivered;
    expect(mail.subject).toBe("Nokka 새 사용 신청 3건");
    expect(mail.text).toContain("https://nokka-web.vercel.app/admin/applications");
    for (const row of before) {
      expect(`${mail.subject}\n${mail.text}`).not.toContain(row.email);
      expect(`${mail.subject}\n${mail.text}`).not.toContain(row.name);
    }
    expect(mail.text).not.toContain("@");
    const [row] = await runs();
    expect(row).toMatchObject({
      status: "sent",
      application_count: 3,
      attempts: 1,
      lease_expires_at: null,
      idempotency_key: null,
      idempotency_key_used_at: null,
    });
    expect(row.provider_message_id).toMatch(/^[0-9a-f]{16}$/);
    expect(row.last_attempted_at).not.toBeNull();
    expect(warnings).not.toHaveBeenCalled();

    // Repeated cron delivery the same day and a request after the send: no second mail today.
    await apply("d");
    expect(await cron(gmail.mailer)).toEqual(skipped);
    expect(gmail.authorizeCount()).toBe(1);
    expect(await unassigned()).toBe(1);

    await nextDay();
    expect(await cron(gmail.mailer)).toEqual(sent(1));
    expect(gmail.delivered.map((entry) => entry.subject)).toEqual(["Nokka 새 사용 신청 3건", "Nokka 새 사용 신청 1건"]);
    expect(await unassigned()).toBe(0);
    expect((await applicantRows()).slice(0, 3)).toEqual(before);
  });

  it("tries a refused batch once a day, then sends the same batch the next day", async () => {
    await apply("a", "b");
    const gmail = fakeGmail();
    gmail.sends.push("reject");
    expect(await cron(gmail.mailer)).toEqual(unavailable);
    const [failed] = await runs();
    expect(failed).toMatchObject({
      status: "failed",
      application_count: 2,
      attempts: 1,
      error_code: "gmail_send_403_dailyLimitExceeded",
      lease_expires_at: null,
      sent_at: null,
    });
    expect(errors).toHaveBeenCalledWith("[application-digest]", "digest not sent", {
      reason: "failed",
      code: "gmail_send_403_dailyLimitExceeded",
    });

    // Same day: repeated and concurrent calls make no further send attempt (nor token request).
    await apply("c");
    const again = await Promise.all(Array.from({ length: 5 }, () => cron(gmail.mailer)));
    for (const result of again) expect(result.body).toMatchObject({ ok: true, count: 0 });
    expect(gmail.sendCount()).toBe(1);
    expect(gmail.authorizeCount()).toBe(1);

    await nextDay();
    expect(await cron(gmail.mailer)).toEqual(sent(2));
    const [retried] = await runs();
    expect(retried).toMatchObject({ id: failed.id, status: "sent", attempts: 2, error_code: null });
    expect(warnings).not.toHaveBeenCalled();
    expect(gmail.delivered).toHaveLength(1);
    expect(await unassigned()).toBe(1);

    await nextDay();
    expect(await cron(gmail.mailer)).toEqual(sent(1));
    expect(await unassigned()).toBe(0);
  });

  it("records a revoked token as failed with no send, and retries the token the same day", async () => {
    await apply("a");
    const gmail = fakeGmail();
    gmail.tokens.push("gmail_token_400_invalid_grant", "gmail_token_400_invalid_grant");
    expect(await cron(gmail.mailer)).toEqual(unavailable);
    const [row] = await runs();
    expect(row).toMatchObject({
      status: "failed",
      error_code: "gmail_token_400_invalid_grant",
      last_attempted_at: null,
      sent_at: null,
    });

    expect(await cron(gmail.mailer)).toEqual(unavailable);
    expect(gmail.sendCount()).toBe(0);
    // Consent renewed later that day: no send was attempted today, so it goes out now.
    expect(await cron(gmail.mailer)).toEqual(sent(1));
    expect(gmail.authorizeCount()).toBe(3);
    expect(gmail.sendCount()).toBe(1);
  });

  it("sends exactly once when many cron calls arrive together", async () => {
    await apply("a", "b", "c");
    const gmail = fakeGmail({ delayMs: 100 });
    const results = await Promise.all(Array.from({ length: 10 }, () => cron(gmail.mailer)));

    expect(gmail.sendCount()).toBe(1);
    expect(results.filter((result) => result.body.status === "sent")).toEqual([sent(3)]);
    for (const result of results) {
      expect(result.status).toBe(200);
      expect(["sent", "busy", "skipped"]).toContain(result.body.status);
    }
    const rows = await runs();
    expect(rows.filter((row) => row.status === "sent")).toHaveLength(1);
    expect(rows.filter((row) => row.status !== "sent" && row.status !== "skipped")).toEqual([]);
    const [{ items }] = await sql`SELECT count(*)::int AS items FROM application_digest_items`;
    expect(items).toBe(3);
  });

  it("resends a mail that was accepted but not recorded on the next day only (one possible repeat)", async () => {
    await apply("a", "b");
    const gmail = fakeGmail();
    expect(await cron(gmail.mailer, failingMarkSent())).toEqual(unavailable);
    const [pending] = await runs();
    expect(pending).toMatchObject({ status: "sending", attempts: 1, sent_at: null });

    expect(await cron(gmail.mailer)).toEqual({ status: 200, body: { ok: true, status: "busy", count: 0 } });
    await expireLease();
    expect(await cron(gmail.mailer)).toEqual(skipped);
    expect(gmail.sendCount()).toBe(1);

    await nextDay();
    expect(await cron(gmail.mailer)).toEqual(sent(2));
    expect(warnings).toHaveBeenCalledWith("[application-digest]", REPEAT_WARNING);
    const [row] = await runs();
    expect(row).toMatchObject({ id: pending.id, status: "sent", attempts: 2, application_count: 2 });
    expect(gmail.delivered.map((mail) => mail.subject)).toEqual(["Nokka 새 사용 신청 2건", "Nokka 새 사용 신청 2건"]);
  });

  it("does not resend an uncertain send in the same call or day, and resends the fixed batch next day", async () => {
    await apply("a", "b");
    const gmail = fakeGmail();
    gmail.sends.push("lose_response");
    expect(await cron(gmail.mailer)).toEqual(unavailable);
    expect(gmail.sendCount()).toBe(1);
    const [unknown] = await runs();
    expect(unknown).toMatchObject({ status: "unknown", error_code: "gmail_send_timeout", lease_expires_at: null });
    const items = await batchItems(unknown.id);

    await apply("c");
    expect(await cron(gmail.mailer)).toEqual(skipped);
    expect(gmail.sendCount()).toBe(1);

    await nextDay();
    expect(await cron(gmail.mailer)).toEqual(sent(2));
    expect(warnings).toHaveBeenCalledWith("[application-digest]", REPEAT_WARNING);
    expect(await batchItems(unknown.id)).toEqual(items);
    // The lost response had been delivered: the documented one possible repeat.
    expect(gmail.delivered).toHaveLength(2);
    expect(await unassigned()).toBe(1);
  });

  it("delivers once when the uncertain send had not reached Gmail", async () => {
    await apply("a");
    const gmail = fakeGmail();
    gmail.sends.push("fail_before");
    expect(await cron(gmail.mailer)).toEqual(unavailable);
    await nextDay();
    expect(await cron(gmail.mailer)).toEqual(sent(1));
    expect(gmail.delivered).toHaveLength(1);
  });

  it("keeps a possibly delivered batch unknown when the next try fails, so the repeat stays visible", async () => {
    await apply("a");
    const gmail = fakeGmail();
    gmail.sends.push("lose_response");
    await cron(gmail.mailer);
    await nextDay();
    gmail.tokens.push("gmail_token_400_invalid_grant");
    expect(await cron(gmail.mailer)).toEqual(unavailable);
    const [row] = await runs();
    expect(row).toMatchObject({ status: "unknown", error_code: "gmail_token_400_invalid_grant" });

    expect(await cron(gmail.mailer)).toEqual(sent(1));
    expect(warnings).toHaveBeenCalledWith("[application-digest]", REPEAT_WARNING);
  });

  it("makes one send a day while Gmail stays uncertain, keeping one batch and its items", async () => {
    await apply("a", "b");
    const gmail = fakeGmail();
    gmail.sends.push("fail_before", "fail_before", "fail_before");
    const perDay: number[] = [];
    for (let day = 0; day < 3; day++) {
      const before = gmail.sendCount();
      for (let call = 0; call < 3; call++) await cron(gmail.mailer);
      perDay.push(gmail.sendCount() - before);
      await apply(`late${day}`);
      await nextDay();
    }
    expect(perDay).toEqual([1, 1, 1]);
    const rows = await runs();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "unknown", application_count: 2, attempts: 3 });
    expect(await batchItems(rows[0].id)).toHaveLength(2);
    expect(await unassigned()).toBe(3);

    expect(await cron(gmail.mailer)).toEqual(sent(2));
    expect(gmail.delivered).toHaveLength(1);
  });

  it("fences out a sender whose lease was taken over", async () => {
    await apply("a");
    const store = createDigestStore(sql);
    const first = await store.claim();
    if (first.kind !== "send") throw new Error(`expected a batch, got ${first.kind}`);
    await expireLease();
    expect(await store.markSendAttempt(first.batch)).toBe(false);
    const second = await store.claim();
    if (second.kind !== "send") throw new Error(`expected a batch, got ${second.kind}`);

    expect(second.batch).toMatchObject({ id: first.batch.id, attempt: 2, mayRepeat: false });
    expect(await store.markSendAttempt(second.batch)).toBe(true);
    expect(await store.markFailed(first.batch, "gmail_send_500")).toBe(false);
    expect(await store.markSent(first.batch, "stale")).toBe(false);
    expect(await store.markSent(second.batch, "fresh")).toBe(true);
    const [row] = await runs();
    expect(row).toMatchObject({ status: "sent", provider_message_id: "fresh" });
  });

  it("puts every request into exactly one batch while requests and cron calls race", async () => {
    const gmail = fakeGmail({ delayMs: 5 });
    const store = createApplicationStore(sql);
    const labels = Array.from({ length: 40 }, (_, i) => `race${i}`);
    await Promise.all([
      ...labels.map((label) => store.save({ name: `QA ${label}`, email: email(label) })),
      ...Array.from({ length: 5 }, () => cron(gmail.mailer)),
    ]);
    for (let day = 0; day < 3 && (await unassigned()) > 0; day++) {
      await nextDay();
      await cron(gmail.mailer);
    }

    expect(await unassigned()).toBe(0);
    const [{ total, distinct }] = await sql`
      SELECT count(*)::int AS total, count(DISTINCT application_id)::int AS distinct FROM application_digest_items
    `;
    expect(total).toBe(40);
    expect(distinct).toBe(40);
    const sentRows = (await runs()).filter((row) => row.status === "sent");
    expect(sentRows.reduce((sum, row) => sum + row.application_count, 0)).toBe(40);
    expect(gmail.delivered).toHaveLength(sentRows.length);
  });
});
