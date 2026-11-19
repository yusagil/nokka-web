import "server-only";
import postgres from "postgres";

export type Database = postgres.Sql;

let database: Database | undefined;

/** Shared Postgres client for the applications API, or null while DATABASE_URL is not set. */
export function getDatabase(): Database | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  database ??= postgres(url, {
    max: 3,
    // Unnamed statements keep the client usable behind transaction-mode poolers.
    prepare: false,
    connect_timeout: 5,
    idle_timeout: 20,
    onnotice: () => {},
  });
  return database;
}
