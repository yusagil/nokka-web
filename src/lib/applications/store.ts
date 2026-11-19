import "server-only";
import type { ApplicationRequest } from "./contracts";
import type { Database } from "./db";

export type SaveOutcome = "created" | "existing";

export type ApplicationStore = {
  /** Resolves only once the request is durably stored (new row) or an earlier row is confirmed. */
  save(application: ApplicationRequest): Promise<SaveOutcome>;
};

export function createApplicationStore(sql: Database): ApplicationStore {
  return {
    async save({ name, email }) {
      // An earlier request for the same normalized email is kept as is (name and created_at too).
      const inserted = await sql`
        INSERT INTO access_applications (name, email)
        VALUES (${name}, ${email})
        ON CONFLICT (email_normalized) DO NOTHING
        RETURNING id
      `;
      if (inserted.length === 1) return "created";

      // Separate statement so it reads with a fresh snapshot that includes a concurrent insert
      // the conflict waited for.
      const existing = await sql`
        SELECT 1 FROM access_applications WHERE email_normalized = lower(btrim(${email}))
      `;
      if (existing.length === 1) return "existing";
      throw new Error("Conflicting application row was not found");
    },
  };
}
