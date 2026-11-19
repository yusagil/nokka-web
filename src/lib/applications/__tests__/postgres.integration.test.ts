// @vitest-environment node
// Runs against a real Postgres only when APPLICATIONS_TEST_DATABASE_URL is set (a direct, non-pooled
// test database). Everything happens in a fresh schema that is dropped afterwards; use synthetic
// data only and never point this at the production list.
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, it, expect, vi } from "vitest";
import { applyMigrations } from "../../../../scripts/db-migrate.mjs";
import { createApplicationsHandler } from "../handler";
import { createRateLimiter, RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_SECONDS } from "../rate-limit";
import { createApplicationStore } from "../store";

vi.mock("server-only", () => ({}));
// Remote test databases add a network round trip to every query; the limit tests make dozens.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const url = process.env.APPLICATIONS_TEST_DATABASE_URL;
const run = randomUUID().replaceAll("-", "").slice(0, 10);
const schema = `nokka_apply_test_${run}`;
const SITE = "https://nokka-web.vercel.app";
const email = (label: string) => `nokka-apply-qa-${run}-${label}@example.com`;

describe.skipIf(!url)("applications storage on Postgres", () => {
  let admin: postgres.Sql;
  let sql: postgres.Sql;

  beforeAll(async () => {
    admin = postgres(url!, { max: 1, onnotice: () => {} });
    await admin`CREATE SCHEMA ${admin(schema)}`;
    sql = postgres(url!, {
      max: 10,
      prepare: false,
      onnotice: () => {},
      // `options` rather than a search_path startup parameter: Neon ignores the latter.
      connection: { options: `-c search_path=${schema}` },
    });
    // Stop before touching anything if the connection is not confined to the test schema.
    const [{ current }] = await sql`SELECT current_schema() AS current`;
    if (current !== schema) throw new Error(`Test connection is not isolated (schema: ${current})`);
    expect(await applyMigrations(sql)).toEqual(["0001_access_applications.sql"]);
  });

  afterAll(async () => {
    await sql?.end();
    if (admin) {
      await admin`DROP SCHEMA IF EXISTS ${admin(schema)} CASCADE`;
      await admin.end();
    }
  });

  const rows = (address: string) => sql<{ name: string; email: string; created_at: Date }[]>`
    SELECT name, email, created_at FROM access_applications
    WHERE email_normalized = lower(btrim(${address}))
  `;

  describe("migrations", () => {
    it("records applied files and does not re-apply them", async () => {
      expect(await applyMigrations(sql)).toEqual([]);
      const applied = await sql`SELECT name FROM schema_migrations`;
      expect(applied.map((row) => row.name)).toEqual(["0001_access_applications.sql"]);
    });

    it("enables row level security on both tables", async () => {
      const tables = await sql`
        SELECT relname, relrowsecurity FROM pg_class
        WHERE relnamespace = ${schema}::regnamespace
          AND relname IN ('access_applications', 'application_rate_limits')
        ORDER BY relname
      `;
      expect(tables.map((row) => [row.relname, row.relrowsecurity])).toEqual([
        ["access_applications", true],
        ["application_rate_limits", true],
      ]);
    });

    it("enforces the field limits in the database too", async () => {
      for (const name of ["", "a".repeat(101)]) {
        await expect(
          sql`INSERT INTO access_applications (name, email) VALUES (${name}, ${email("check")})`,
        ).rejects.toMatchObject({ code: "23514" });
      }
      await expect(
        sql`INSERT INTO access_applications (name, email, email_normalized)
            VALUES ('QA', ${email("generated")}, 'x')`,
      ).rejects.toMatchObject({ code: "428C9" });
    });
  });

  describe("store", () => {
    it("stores a new request with a normalized duplicate key", async () => {
      const store = createApplicationStore(sql);
      expect(await store.save({ name: "QA 신청 테스트", email: email("New") })).toBe("created");

      const [row] = await sql`
        SELECT name, email, email_normalized FROM access_applications WHERE email = ${email("New")}
      `;
      expect(row).toEqual({
        name: "QA 신청 테스트",
        email: email("New"),
        email_normalized: email("new"),
      });
    });

    it("keeps the first row when the same email is submitted again", async () => {
      const store = createApplicationStore(sql);
      const address = email("dup");
      expect(await store.save({ name: "QA First", email: address })).toBe("created");
      const [first] = await rows(address);

      expect(await store.save({ name: "QA Second", email: address.toUpperCase() })).toBe("existing");
      expect(await rows(address)).toEqual([first]);
    });

    it("converges concurrent submissions of one email into a single row", async () => {
      const store = createApplicationStore(sql);
      const address = email("race");
      const variants = Array.from({ length: 20 }, (_, i) => ({
        name: `QA Race ${i}`,
        email: i % 2 ? address.toUpperCase() : address,
      }));

      const outcomes = await Promise.all(variants.map((application) => store.save(application)));

      expect(outcomes.filter((outcome) => outcome === "created")).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome === "existing")).toHaveLength(19);
      expect(await rows(address)).toHaveLength(1);
    });
  });

  describe("rate limiter", () => {
    it(`allows ${RATE_LIMIT_MAX_REQUESTS} requests per window and stores only an HMAC of the IP`, async () => {
      const limiter = createRateLimiter(sql, "test-secret");
      const ip = "203.0.113.10";
      for (let i = 0; i < RATE_LIMIT_MAX_REQUESTS; i++) {
        expect(await limiter.consume(ip)).toEqual({ allowed: true });
      }

      const denied = await limiter.consume(ip);
      expect(denied.allowed).toBe(false);
      if (!denied.allowed) {
        expect(denied.retryAfterSeconds).toBeGreaterThan(0);
        expect(denied.retryAfterSeconds).toBeLessThanOrEqual(RATE_LIMIT_WINDOW_SECONDS);
      }
      expect(await limiter.consume("203.0.113.11")).toEqual({ allowed: true });

      const keys = await sql`SELECT key_hash FROM application_rate_limits`;
      for (const { key_hash } of keys) {
        expect(key_hash).toMatch(/^[0-9a-f]{64}$/);
        expect(key_hash).not.toContain("203.0.113");
      }
    });

    it("counts concurrent requests atomically", async () => {
      const limiter = createRateLimiter(sql, "test-secret");
      const decisions = await Promise.all(
        Array.from({ length: 15 }, () => limiter.consume("203.0.113.20")),
      );
      expect(decisions.filter((decision) => decision.allowed)).toHaveLength(RATE_LIMIT_MAX_REQUESTS);
    });

    it("deletes finished windows and starts a new one", async () => {
      const limiter = createRateLimiter(sql, "test-secret");
      const expired = "203.0.113.30";
      for (let i = 0; i <= RATE_LIMIT_MAX_REQUESTS; i++) await limiter.consume(expired);
      await sql`
        UPDATE application_rate_limits
        SET window_started_at = now() - make_interval(secs => ${RATE_LIMIT_WINDOW_SECONDS + 1})
      `;

      await limiter.consume("203.0.113.31");
      const [{ count }] = await sql`SELECT count(*)::int AS count FROM application_rate_limits`;
      expect(count).toBe(1);
      expect(await limiter.consume(expired)).toEqual({ allowed: true });
    });
  });

  describe("POST /api/applications end to end", () => {
    const handler = () =>
      createApplicationsHandler({
        getServices: () => ({
          store: createApplicationStore(sql),
          rateLimiter: createRateLimiter(sql, "test-secret"),
        }),
        getAllowedOrigins: () => new Set([SITE]),
        allowLocalOrigins: false,
      });

    const post = (body: unknown, ip: string) =>
      new Request("http://localhost/api/applications", {
        method: "POST",
        headers: { origin: SITE, "content-type": "application/json", "x-real-ip": ip },
        body: JSON.stringify(body),
      });

    it("answers 200 only with a stored row, and once per normalized email", async () => {
      const address = email("e2e");
      const first = await handler()(post({ name: "QA 신청 테스트", email: address }, "198.51.100.1"));
      expect(first.status).toBe(200);
      expect(await first.json()).toEqual({ ok: true });
      expect(await rows(address)).toHaveLength(1);

      const again = await handler()(
        post({ name: "QA 다시", email: ` ${address.toUpperCase()} ` }, "198.51.100.1"),
      );
      expect(again.status).toBe(200);
      const stored = await rows(address);
      expect(stored).toHaveLength(1);
      expect(stored[0].name).toBe("QA 신청 테스트");
    });

    it("answers 429 with Retry-After and stores nothing past the limit", async () => {
      const ip = "198.51.100.2";
      for (let i = 0; i < RATE_LIMIT_MAX_REQUESTS; i++) {
        const response = await handler()(post({ name: "QA Limit", email: email(`limit${i}`) }, ip));
        expect(response.status).toBe(200);
      }

      const blocked = await handler()(post({ name: "QA Limit", email: email("limit-over") }, ip));
      expect(blocked.status).toBe(429);
      expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
      expect(await rows(email("limit-over"))).toHaveLength(0);
    });

    it("answers 503 and stores nothing when the database is unreachable", async () => {
      const unreachable = postgres("postgres://nokka_test@127.0.0.1:1/unreachable", {
        max: 1,
        connect_timeout: 1,
        onnotice: () => {},
      });
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const response = await createApplicationsHandler({
          getServices: () => ({
            store: createApplicationStore(unreachable),
            rateLimiter: createRateLimiter(unreachable, "test-secret"),
          }),
          getAllowedOrigins: () => new Set([SITE]),
        })(post({ name: "QA Down", email: email("down") }, "198.51.100.3"));

        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({ ok: false, code: "UNAVAILABLE" });
        expect(await rows(email("down"))).toHaveLength(0);
        expect(JSON.stringify(errors.mock.calls)).not.toContain(email("down"));
      } finally {
        errors.mockRestore();
        await unreachable.end();
      }
    });
  });
});
