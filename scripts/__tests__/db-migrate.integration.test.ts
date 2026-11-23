// @vitest-environment node
// Runs against a real Postgres only when APPLICATIONS_TEST_DATABASE_URL is set (a disposable, direct
// test database). Every case migrates its own fresh schema, dropped afterwards; synthetic data only.
import { copyFile, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { applyMigrations } from "../db-migrate.mjs";

// Remote test databases add a round trip per query, and each case opens several connections.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const url = process.env.APPLICATIONS_TEST_DATABASE_URL;
const run = randomUUID().replaceAll("-", "").slice(0, 10);
const MIGRATIONS_DIR = fileURLToPath(new URL("../../db/migrations/", import.meta.url));
/** Runners started together, each on its own connection like separate `npm run db:migrate` processes. */
const RUNNERS = 6;
/** The first-run race does not show on every attempt, so the empty-schema case repeats. */
const ROUNDS = 5;

describe.skipIf(!url)("db-migrate on Postgres", () => {
  let admin: postgres.Sql;
  let migrations: string[];
  let scratchDir: string;
  const schemas: string[] = [];

  beforeAll(async () => {
    admin = postgres(url!, { max: 1, onnotice: () => {} });
    migrations = (await readdir(MIGRATIONS_DIR)).filter((file) => file.endsWith(".sql")).sort();
    scratchDir = await mkdtemp(join(tmpdir(), "nokka-migrate-test-"));
  });

  afterAll(async () => {
    if (scratchDir) await rm(scratchDir, { recursive: true, force: true });
    if (admin) {
      for (const schema of schemas) await admin`DROP SCHEMA IF EXISTS ${admin(schema)} CASCADE`;
      await admin.end();
    }
  });

  async function freshSchema(label: string) {
    const schema = `nokka_migrate_test_${run}_${label}`;
    schemas.push(schema);
    await admin`CREATE SCHEMA ${admin(schema)}`;
    return schema;
  }

  const end = (clients: postgres.Sql[]) => Promise.all(clients.map((client) => client.end()));

  /** Opens `count` single-connection clients confined to `schema`, already connected. */
  async function connect(schema: string, count: number) {
    const clients = Array.from({ length: count }, () =>
      postgres(url!, { max: 1, prepare: false, onnotice: () => {}, connection: { options: `-c search_path=${schema}` } }),
    );
    try {
      for (const client of clients) {
        // Stop before touching anything if a connection is not confined to the test schema.
        const [{ current }] = await client`SELECT current_schema() AS current`;
        if (current !== schema) throw new Error(`Test connection is not isolated (schema: ${current})`);
      }
    } catch (error) {
      // The caller never receives these clients, so close the ones already connected here.
      await end(clients);
      throw error;
    }
    return clients;
  }

  /** Starts one runner per client at once; returns what each applied, or rejects listing every outcome. */
  async function startTogether(clients: postgres.Sql[], dir = MIGRATIONS_DIR) {
    const results = await Promise.allSettled(clients.map((client) => applyMigrations(client, dir)));
    const outcomes = results.map((result) => (result.status === "fulfilled" ? "ok" : (result.reason?.code ?? "error")));
    return { outcomes, applied: results.flatMap((result) => (result.status === "fulfilled" ? result.value : [])) };
  }

  const ledger = (sql: postgres.Sql) =>
    sql<{ name: string; applied_at: Date }[]>`SELECT name, applied_at FROM schema_migrations ORDER BY applied_at, name`;

  it("creates the ledger and applies every file once when runners start together on an empty schema", async () => {
    for (let round = 1; round <= ROUNDS; round++) {
      const clients = await connect(await freshSchema(`empty${round}`), RUNNERS);
      try {
        const { outcomes, applied } = await startTogether(clients);
        expect(outcomes, `round ${round}`).toEqual(Array(RUNNERS).fill("ok"));
        // Across all runners, each file was applied by exactly one of them...
        expect(applied.sort()).toEqual(migrations);
        // ...and in file-name order.
        expect((await ledger(clients[0])).map((row) => row.name)).toEqual(migrations);
        expect(await applyMigrations(clients[0])).toEqual([]);
      } finally {
        await end(clients);
      }
    }
  });

  it("keeps existing rows and applies only the pending files when runners start together", async () => {
    const legacyDir = await mkdtemp(join(scratchDir, "legacy-"));
    const legacy = migrations.filter((file) => /^000[1-3]_/.test(file));
    for (const name of legacy) await copyFile(join(MIGRATIONS_DIR, name), join(legacyDir, name));

    const clients = await connect(await freshSchema("existing"), RUNNERS);
    try {
      expect(await applyMigrations(clients[0], legacyDir)).toEqual(legacy);
      for (const label of ["first", "second"]) {
        await clients[0]`INSERT INTO access_applications (name, email) VALUES (${`QA ${label}`}, ${`nokka-migrate-qa-${run}-${label}@example.com`})`;
      }
      const rows = () => clients[0]`SELECT id, name, email, created_at FROM access_applications ORDER BY id`;
      const rowsBefore = await rows();
      const ledgerBefore = await ledger(clients[0]);

      const { outcomes, applied } = await startTogether(clients);
      expect(outcomes).toEqual(Array(RUNNERS).fill("ok"));
      expect(applied.sort()).toEqual(migrations.filter((file) => !legacy.includes(file)));
      expect(await rows()).toEqual(rowsBefore);
      const ledgerAfter = await ledger(clients[0]);
      expect(ledgerAfter.slice(0, legacy.length)).toEqual(ledgerBefore);
      expect(ledgerAfter.map((row) => row.name)).toEqual(migrations);
      expect(await applyMigrations(clients[0])).toEqual([]);
    } finally {
      await end(clients);
    }
  });

  it("rolls back a failing file and applies it once when the runners retry", async () => {
    const dir = await mkdtemp(join(scratchDir, "retry-"));
    await copyFile(join(MIGRATIONS_DIR, migrations[0]), join(dir, migrations[0]));
    const broken = "0002_qa_retry.sql";
    await writeFile(join(dir, broken), "CREATE TABLE qa_retry (id integer);\nSELECT 1 / 0;\n");

    const clients = await connect(await freshSchema("retry"), RUNNERS);
    try {
      // Every runner reaches the broken file and stops there with the file's own error.
      const failed = await startTogether(clients, dir);
      expect(failed.outcomes).toEqual(Array(RUNNERS).fill("22012"));
      expect(failed.applied).toEqual([]);
      expect((await ledger(clients[0])).map((row) => row.name)).toEqual([migrations[0]]);
      const [{ half }] = await clients[0]`SELECT to_regclass('qa_retry') IS NOT NULL AS half`;
      expect(half).toBe(false);

      await writeFile(join(dir, broken), "CREATE TABLE qa_retry (id integer);\n");
      const retried = await startTogether(clients, dir);
      expect(retried.outcomes).toEqual(Array(RUNNERS).fill("ok"));
      expect(retried.applied).toEqual([broken]);
      expect((await ledger(clients[0])).map((row) => row.name)).toEqual([migrations[0], broken]);
      expect(await applyMigrations(clients[0], dir)).toEqual([]);
    } finally {
      await end(clients);
    }
  });
});
