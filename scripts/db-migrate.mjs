// Applies db/migrations/*.sql in file-name order, each once, recorded in schema_migrations.
// Usage: DATABASE_URL=... npm run db:migrate   (or: node --env-file=.env.local scripts/db-migrate.mjs)
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import postgres from "postgres";

const MIGRATIONS_DIR = fileURLToPath(new URL("../db/migrations/", import.meta.url));

/** Returns the names of the migrations applied by this call. */
export async function applyMigrations(sql, dir = MIGRATIONS_DIR) {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  const files = (await readdir(dir)).filter((file) => file.endsWith(".sql")).sort();
  const applied = [];
  for (const name of files) {
    const statements = await readFile(join(dir, name), "utf8");
    const didApply = await sql.begin(async (tx) => {
      // Serializes concurrent runners; the loser sees the migration as already applied.
      await tx`LOCK TABLE schema_migrations IN EXCLUSIVE MODE`;
      const [done] = await tx`SELECT 1 FROM schema_migrations WHERE name = ${name}`;
      if (done) return false;
      await tx.unsafe(statements).simple();
      await tx`INSERT INTO schema_migrations (name) VALUES (${name})`;
      return true;
    });
    if (didApply) applied.push(name);
  }
  return applied;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set.");
    process.exitCode = 1;
    return;
  }
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  try {
    const applied = await applyMigrations(sql);
    console.log(applied.length ? `Applied: ${applied.join(", ")}` : "No pending migrations.");
  } finally {
    await sql.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    // Only the error class and code: messages can include connection details.
    console.error("Migration failed:", error?.name ?? "Error", error?.code ?? "");
    process.exitCode = 1;
  });
}
