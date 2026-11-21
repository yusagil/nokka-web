import "server-only";
import type { Database } from "@/lib/applications/db";
import type { AdminApplication, ApplicationStatus, StatusFilter } from "./contracts";

/** Keyset position: created_at with full database precision plus the id tie-breaker. */
export type SearchCursor = { createdAt: string; id: string };

export type SearchParams = {
  q: string;
  status: StatusFilter;
  cursor: SearchCursor | null;
  limit: number;
};

export type UpdateParams = {
  status?: ApplicationStatus;
  operatorNote?: string;
  updatesApproved?: boolean;
  expectedUpdatedAt: string;
};

export type UpdateOutcome =
  | { kind: "updated"; item: AdminApplication }
  | { kind: "not_found" }
  | { kind: "conflict" };

export type AdminApplicationsStore = {
  search(params: SearchParams): Promise<{ items: AdminApplication[]; nextCursor: SearchCursor | null }>;
  update(id: string, params: UpdateParams): Promise<UpdateOutcome>;
};

type Row = AdminApplication & { cursorCreatedAt: string };

export function createAdminApplicationsStore(sql: Database): AdminApplicationsStore {
  // Millisecond UTC ISO strings for the API; the cursor keeps microseconds so paging never skips rows.
  // Timestamps go in as text and are cast in SQL: a timestamptz parameter would pass through a JS Date
  // and lose the microseconds.
  const columns = sql`
    id::text AS id,
    name,
    email,
    to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt",
    status,
    operator_note AS "operatorNote",
    to_char(last_contacted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "lastContactedAt",
    to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "updatedAt",
    updates_approved AS "updatesApproved",
    to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorCreatedAt"
  `;

  return {
    async search({ q, status, cursor, limit }) {
      const pattern = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
      const rows = await sql<Row[]>`
        SELECT ${columns}
        FROM access_applications
        WHERE true
          ${status === "all" ? sql`` : sql`AND status = ${status}`}
          ${q ? sql`AND (name ILIKE ${pattern} ESCAPE '\\' OR email ILIKE ${pattern} ESCAPE '\\')` : sql``}
          ${cursor ? sql`AND (created_at, id) < ((${cursor.createdAt}::text)::timestamptz, ${cursor.id}::bigint)` : sql``}
        ORDER BY created_at DESC, id DESC
        LIMIT ${limit + 1}
      `;
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        items: page.map(toItem),
        nextCursor: rows.length > limit && last ? { createdAt: last.cursorCreatedAt, id: last.id } : null,
      };
    },

    async update(id, { status, operatorNote, updatesApproved, expectedUpdatedAt }) {
      const approved = updatesApproved ?? null;
      return sql.begin(async (tx): Promise<UpdateOutcome> => {
        // The token comparison and the write are one statement, so they cannot interleave with another
        // save. It also takes the row lock that update registrations take first (then their codes), so
        // a withdrawal and a registration in flight are applied one after the other.
        const [row] = await tx<Row[]>`
          UPDATE access_applications SET
            status = coalesce(${status ?? null}::text, status),
            operator_note = coalesce(${operatorNote ?? null}::text, operator_note),
            last_contacted_at = CASE
              WHEN ${status ?? null}::text = 'contacted' AND status <> 'contacted' THEN now()
              ELSE last_contacted_at
            END,
            updates_approved = coalesce(${approved}::boolean, updates_approved),
            -- A real change starts a new generation: earlier codes and sessions stop working. Saving
            -- the same value keeps everything as it is.
            updates_generation = CASE
              WHEN ${approved}::boolean IS DISTINCT FROM updates_approved AND ${approved}::boolean IS NOT NULL
                THEN updates_generation + 1
              ELSE updates_generation
            END,
            active_installation_id = CASE WHEN ${approved}::boolean = false THEN NULL ELSE active_installation_id END,
            updated_at = greatest(date_trunc('milliseconds', clock_timestamp()), updated_at + interval '1 millisecond')
          WHERE id = ${id}::bigint AND updated_at = (${expectedUpdatedAt}::text)::timestamptz
          RETURNING ${columns}
        `;
        if (!row) {
          const [exists] = await tx`SELECT 1 FROM access_applications WHERE id = ${id}::bigint`;
          return exists ? { kind: "conflict" } : { kind: "not_found" };
        }
        if (approved === false) {
          // Withdrawn: the registered Mac (pointer cleared above), its sessions (new generation) and
          // unused codes all end in this transaction. Turning it back on later needs a new code.
          await tx`UPDATE update_challenges SET state = 'void' WHERE application_id = ${id}::bigint AND state = 'pending'`;
        }
        return { kind: "updated", item: toItem(row) };
      });
    },
  };
}

function toItem(row: Row): AdminApplication {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    createdAt: row.createdAt,
    status: row.status,
    operatorNote: row.operatorNote,
    lastContactedAt: row.lastContactedAt,
    updatedAt: row.updatedAt,
    updatesApproved: row.updatesApproved,
  };
}
