// @vitest-environment node
// Runs against a real Postgres only when APPLICATIONS_TEST_DATABASE_URL is set (a disposable, direct
// test database). Everything happens in a fresh schema that is dropped afterwards; synthetic data only.
import { createHmac, randomUUID } from "node:crypto";
import { inspect } from "node:util";
import { Pool } from "pg";
import postgres from "postgres";
import { afterAll, beforeAll, describe, it, expect, vi } from "vitest";
import { applyMigrations } from "../../../../scripts/db-migrate.mjs";
import { createApplicationStore } from "@/lib/applications/store";
import { createAdminApplicationsStore } from "../applications-store";
import { createAuth, readAuthConfig, type Auth, type AuthConfig } from "../better-auth";
import { createSearchHandler, createUpdateHandler } from "../handlers";
import { getAdminSession } from "../session";

const holder = vi.hoisted(() => ({ current: null as null | { auth: Auth; config: AuthConfig } }));

vi.mock("server-only", () => ({}));
vi.mock("../better-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../better-auth")>()),
  getAuth: () => holder.current,
}));
// Remote test databases add a round trip per query.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const url = process.env.APPLICATIONS_TEST_DATABASE_URL;
const run = randomUUID().replaceAll("-", "").slice(0, 10);
const schema = `nokka_admin_test_${run}`;
const ADMIN_ID = "212495406";
const BASE_URL = "http://localhost:3000";
const SECRET = `test-secret-${run}-0123456789abcdef`;
const RUN_PREFIX = `nokka-apply-qa-${run}-`;
const email = (label: string) => `${RUN_PREFIX}${label}@example.com`;

describe.skipIf(!url)("admin inbox on Postgres", () => {
  let admin: postgres.Sql;
  let sql: postgres.Sql;
  let pool: Pool;

  beforeAll(async () => {
    admin = postgres(url!, { max: 1, onnotice: () => {} });
    await admin`CREATE SCHEMA ${admin(schema)}`;
    sql = postgres(url!, {
      max: 10,
      prepare: false,
      onnotice: () => {},
      connection: { options: `-c search_path=${schema}` },
    });
    const [{ current }] = await sql`SELECT current_schema() AS current`;
    if (current !== schema) throw new Error(`Test connection is not isolated (schema: ${current})`);
    expect(await applyMigrations(sql)).toEqual(
      expect.arrayContaining(["0001_access_applications.sql", "0002_admin_inbox.sql"]),
    );

    pool = new Pool({ connectionString: url, max: 3, options: `-c search_path=${schema}` });
    const config = readAuthConfig({
      BETTER_AUTH_SECRET: SECRET,
      BETTER_AUTH_URL: BASE_URL,
      GITHUB_CLIENT_ID: "client-id",
      GITHUB_CLIENT_SECRET: "client-secret",
      ADMIN_GITHUB_USER_ID: ADMIN_ID,
      DATABASE_URL: url,
    })!;
    holder.current = { auth: createAuth(config, pool), config };
  });

  afterAll(async () => {
    holder.current = null;
    await pool?.end();
    await sql?.end();
    if (admin) {
      await admin`DROP SCHEMA IF EXISTS ${admin(schema)} CASCADE`;
      await admin.end();
    }
  });

  const store = () => createAdminApplicationsStore(sql);

  async function insert(label: string, name = `QA ${label}`) {
    const [row] = await sql`
      INSERT INTO access_applications (name, email) VALUES (${name}, ${email(label)}) RETURNING id::text AS id
    `;
    return row.id as string;
  }

  async function itemOf(id: string) {
    const { items } = await store().search({ q: RUN_PREFIX, status: "all", cursor: null, limit: 50 });
    const item = items.find((candidate) => candidate.id === id);
    if (!item) throw new Error(`row ${id} not found`);
    return item;
  }

  describe("migration 0002", () => {
    it("starts existing and new requests as new with an empty note", async () => {
      expect(await createApplicationStore(sql).save({ name: "QA 기본값", email: email("defaults") })).toBe("created");
      const [row] = await sql`
        SELECT status, operator_note, last_contacted_at, updated_at FROM access_applications
        WHERE email = ${email("defaults")}
      `;
      expect(row).toMatchObject({ status: "new", operator_note: "", last_contacted_at: null });
      expect(row.updated_at).toBeInstanceOf(Date);
    });

    it("rejects invalid statuses and notes over 500 characters in the database", async () => {
      const id = await insert("db-check");
      await expect(sql`UPDATE access_applications SET status = 'done' WHERE id = ${id}`).rejects.toMatchObject({
        code: "23514",
      });
      await expect(
        sql`UPDATE access_applications SET operator_note = ${"a".repeat(501)} WHERE id = ${id}`,
      ).rejects.toMatchObject({ code: "23514" });
    });

    it("enables row level security on the auth tables", async () => {
      const tables = await sql`
        SELECT relname FROM pg_class
        WHERE relnamespace = ${schema}::regnamespace AND relname LIKE 'auth_%' AND relkind = 'r' AND relrowsecurity
        ORDER BY relname
      `;
      expect(tables.map((row) => row.relname)).toEqual(["auth_account", "auth_session", "auth_user", "auth_verification"]);
    });
  });

  describe("search", () => {
    it("pages newest first without skipping or repeating rows that share created_at", async () => {
      const ids = await sql.begin(async (tx) => {
        const rows = [];
        // One transaction: all five rows get the same now().
        for (let i = 0; i < 5; i++) {
          const [row] = await tx`
            INSERT INTO access_applications (name, email) VALUES (${`QA Page ${i}`}, ${email(`page${i}`)})
            RETURNING id::text AS id
          `;
          rows.push(row.id as string);
        }
        return rows;
      });

      const seen: string[] = [];
      let cursor = null;
      do {
        const page: Awaited<ReturnType<ReturnType<typeof store>["search"]>> = await store().search({
          q: "QA Page",
          status: "all",
          cursor,
          limit: 2,
        });
        seen.push(...page.items.map((item) => item.id));
        cursor = page.nextCursor;
      } while (cursor);

      expect(seen).toEqual([...ids].reverse());
    });

    it("filters by status and matches name or email case-insensitively", async () => {
      const alpha = await insert("Alpha", "QA Alpha 신청");
      const beta = await insert("beta", "QA Beta");
      await sql`UPDATE access_applications SET status = 'hold' WHERE id = ${beta}`;

      const byName = await store().search({ q: "alpha 신청", status: "all", cursor: null, limit: 50 });
      expect(byName.items.map((item) => item.id)).toEqual([alpha]);
      const byEmail = await store().search({ q: email("BETA").toUpperCase(), status: "all", cursor: null, limit: 50 });
      expect(byEmail.items.map((item) => item.id)).toEqual([beta]);
      const held = await store().search({ q: RUN_PREFIX, status: "hold", cursor: null, limit: 50 });
      expect(held.items.map((item) => item.id)).toEqual([beta]);
    });

    it("treats % and _ in the search term as plain characters", async () => {
      const percent = await insert("pct", "QA 100% 확인");
      const underscore = await insert("under", "QA snake_case");
      await insert("plain", "QA snakeXcase 100X");

      const pct = await store().search({ q: "100%", status: "all", cursor: null, limit: 50 });
      expect(pct.items.map((item) => item.id)).toEqual([percent]);
      const under = await store().search({ q: "snake_case", status: "all", cursor: null, limit: 50 });
      expect(under.items.map((item) => item.id)).toEqual([underscore]);
    });
  });

  describe("update", () => {
    it("records the contact time only when the status changes to contacted", async () => {
      const id = await insert("contact");
      const start = await itemOf(id);

      const noted = await store().update(id, { operatorNote: "QA 메모", expectedUpdatedAt: start.updatedAt });
      if (noted.kind !== "updated") throw new Error(noted.kind);
      expect(noted.item).toMatchObject({ operatorNote: "QA 메모", status: "new", lastContactedAt: null });
      expect(noted.item.updatedAt > start.updatedAt).toBe(true);

      const contacted = await store().update(id, { status: "contacted", expectedUpdatedAt: noted.item.updatedAt });
      if (contacted.kind !== "updated") throw new Error(contacted.kind);
      const firstContact = contacted.item.lastContactedAt;
      expect(firstContact).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

      const sameStatus = await store().update(id, {
        status: "contacted",
        operatorNote: "QA 메모 2",
        expectedUpdatedAt: contacted.item.updatedAt,
      });
      if (sameStatus.kind !== "updated") throw new Error(sameStatus.kind);
      expect(sameStatus.item.lastContactedAt).toBe(firstContact);

      const held = await store().update(id, { status: "hold", expectedUpdatedAt: sameStatus.item.updatedAt });
      if (held.kind !== "updated") throw new Error(held.kind);
      expect(held.item).toMatchObject({ status: "hold", lastContactedAt: firstContact });

      const again = await store().update(id, { status: "contacted", expectedUpdatedAt: held.item.updatedAt });
      if (again.kind !== "updated") throw new Error(again.kind);
      expect(again.item.lastContactedAt! > firstContact!).toBe(true);
    });

    it("answers conflict for a stale token and not_found for a missing row", async () => {
      const id = await insert("stale");
      const start = await itemOf(id);
      const first = await store().update(id, { status: "hold", expectedUpdatedAt: start.updatedAt });
      expect(first.kind).toBe("updated");

      expect(await store().update(id, { status: "new", expectedUpdatedAt: start.updatedAt })).toEqual({ kind: "conflict" });
      expect(await store().update("999999999", { status: "new", expectedUpdatedAt: start.updatedAt })).toEqual({
        kind: "not_found",
      });
    });

    it("lets exactly one of two concurrent saves with the same token win", async () => {
      const id = await insert("race");
      const start = await itemOf(id);
      const outcomes = await Promise.all([
        store().update(id, { operatorNote: "QA A", expectedUpdatedAt: start.updatedAt }),
        store().update(id, { operatorNote: "QA B", expectedUpdatedAt: start.updatedAt }),
      ]);
      expect(outcomes.map((outcome) => outcome.kind).sort()).toEqual(["conflict", "updated"]);
    });

    it("keeps status, note and name when the same email is submitted publicly again", async () => {
      const id = await insert("keep", "QA 원래 이름");
      const start = await itemOf(id);
      const saved = await store().update(id, { status: "hold", operatorNote: "QA 보류", expectedUpdatedAt: start.updatedAt });
      if (saved.kind !== "updated") throw new Error(saved.kind);

      expect(await createApplicationStore(sql).save({ name: "QA 새 이름", email: email("KEEP") })).toBe("existing");
      expect(await itemOf(id)).toEqual(saved.item);
    });
  });

  describe("sessions through Better Auth", () => {
    let adminUser: string;
    let otherUser: string;

    beforeAll(async () => {
      adminUser = await createUser("admin", ADMIN_ID);
      otherUser = await createUser("other", "1");
    });

    async function createUser(label: string, githubId: string) {
      const userId = `qa-user-${run}-${label}`;
      await sql`
        INSERT INTO "auth_user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
        VALUES (${userId}, ${`QA ${label}`}, ${email(`user-${label}`)}, true, now(), now())
      `;
      await sql`
        INSERT INTO "auth_account" ("id", "accountId", "providerId", "userId", "createdAt", "updatedAt")
        VALUES (${`qa-account-${run}-${label}`}, ${githubId}, 'github', ${userId}, now(), now())
      `;
      return userId;
    }

    async function createSession(userId: string, label: string, expiresIn = 3600) {
      const token = `qa-token-${run}-${label}`;
      await sql`
        INSERT INTO "auth_session" ("id", "expiresAt", "token", "createdAt", "updatedAt", "userId")
        VALUES (${`qa-session-${run}-${label}`}, now() + make_interval(secs => ${expiresIn}), ${token}, now(), now(), ${userId})
      `;
      return token;
    }

    const cookieFor = (token: string, secret = SECRET) => {
      const signature = createHmac("sha256", secret).update(token).digest("base64");
      return `better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`;
    };
    const headersWith = (cookie?: string) => new Headers(cookie ? { cookie } : {});

    it("allows only one local account per GitHub id", async () => {
      await expect(
        sql`
          INSERT INTO "auth_account" ("id", "accountId", "providerId", "userId", "createdAt", "updatedAt")
          VALUES (${`qa-account-${run}-dup`}, ${ADMIN_ID}, 'github', ${otherUser}, now(), now())
        `,
      ).rejects.toMatchObject({ code: "23505" });
    });

    it("accepts the admin's session and rejects forged, expired, missing and other sessions", async () => {
      const adminToken = await createSession(adminUser, "admin");
      const otherToken = await createSession(otherUser, "other");
      const expiredToken = await createSession(adminUser, "expired", -60);

      expect(await getAdminSession(headersWith(cookieFor(adminToken)))).toEqual({
        ok: true,
        admin: { githubUserId: ADMIN_ID },
      });
      expect(await getAdminSession(headersWith(cookieFor(otherToken)))).toMatchObject({ status: 403 });
      expect(await getAdminSession(headersWith(cookieFor(adminToken, "wrong-secret-0123456789abcdef0123")))).toMatchObject({
        status: 401,
      });
      expect(await getAdminSession(headersWith(cookieFor(`${adminToken}-guess`)))).toMatchObject({ status: 401 });
      expect(await getAdminSession(headersWith(cookieFor(expiredToken)))).toMatchObject({ status: 401 });
      expect(await getAdminSession(headersWith())).toMatchObject({ status: 401 });
    });

    it("serves the admin API end to end only to the admin's session", async () => {
      const adminToken = await createSession(adminUser, "api-admin");
      const otherToken = await createSession(otherUser, "api-other");
      const id = await insert("api");
      const handlers = { getStore: () => store() };
      const post = (cookie?: string) =>
        createSearchHandler(handlers)(
          new Request(`${BASE_URL}/api/admin/applications/search`, {
            method: "POST",
            headers: {
              origin: BASE_URL,
              "content-type": "application/json",
              "x-admin-request": "1",
              ...(cookie ? { cookie } : {}),
            },
            body: JSON.stringify({ q: email("api") }),
          }),
        );

      const ok = await post(cookieFor(adminToken));
      expect(ok.status).toBe(200);
      expect((await ok.json()).items.map((item: { id: string }) => item.id)).toEqual([id]);
      expect((await post(cookieFor(otherToken))).status).toBe(403);
      expect((await post()).status).toBe(401);

      const start = await itemOf(id);
      const patch = await createUpdateHandler(handlers)(
        new Request(`${BASE_URL}/api/admin/applications/${id}`, {
          method: "PATCH",
          headers: {
            origin: BASE_URL,
            "content-type": "application/json",
            "x-admin-request": "1",
            cookie: cookieFor(adminToken),
          },
          body: JSON.stringify({ status: "contacted", expectedUpdatedAt: start.updatedAt }),
        }),
        { params: Promise.resolve({ id }) },
      );
      expect(patch.status).toBe(200);
      expect((await patch.json()).item).toMatchObject({ id, status: "contacted" });
    });

    it("sends a forged or cookieless OAuth state back to login without logging the state", async () => {
      const logged = [vi.spyOn(console, "error"), vi.spyOn(console, "warn")].map((spy) =>
        spy.mockImplementation(() => {}),
      );
      try {
        const { auth } = holder.current!;
        const signIn = await auth.handler(
          new Request(`${BASE_URL}/api/auth/sign-in/social`, {
            method: "POST",
            headers: { origin: BASE_URL, "content-type": "application/json" },
            body: JSON.stringify({
              provider: "github",
              callbackURL: "/admin/applications",
              errorCallbackURL: "/admin/login",
            }),
          }),
        );
        const issued = new URL((await signIn.json()).url).searchParams.get("state")!;
        const forged = `qa-state-${run}-forged`;
        const code = `qa-code-${run}`;

        // An issued state is still a mismatch without the signed state cookie of the browser that started it.
        for (const state of [forged, issued]) {
          const callback = await auth.handler(
            new Request(`${BASE_URL}/api/auth/callback/github?code=${code}&state=${state}`),
          );
          expect(callback.status).toBe(302);
          expect(new URL(callback.headers.get("location")!, BASE_URL).href).toBe(
            `${BASE_URL}/admin/login?error=state_mismatch`,
          );
        }

        const [errors] = logged;
        for (const errorCode of ["state_mismatch", "state_security_mismatch"]) {
          expect(errors).toHaveBeenCalledWith("[better-auth]", "Failed to parse state", {
            name: "BetterAuthError",
            code: errorCode,
          });
        }
        const output = inspect(logged.map((spy) => spy.mock.calls), { depth: null });
        for (const value of [issued, forged, code]) expect(output).not.toContain(value);
      } finally {
        logged.forEach((spy) => spy.mockRestore());
      }
    });
  });
});
