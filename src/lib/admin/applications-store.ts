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

    async update(id, { status, operatorNote, expectedUpdatedAt }) {
      // One atomic statement: the token comparison and the write cannot interleave with another save.
      const [row] = await sql<Row[]>`
        UPDATE access_applications SET
          status = coalesce(${status ?? null}::text, status),
          operator_note = coalesce(${operatorNote ?? null}::text, operator_note),
          last_contacted_at = CASE
            WHEN ${status ?? null}::text = 'contacted' AND status <> 'contacted' THEN now()
            ELSE last_contacted_at
          END,
          updated_at = greatest(date_trunc('milliseconds', clock_timestamp()), updated_at + interval '1 millisecond')
        WHERE id = ${id}::bigint AND updated_at = (${expectedUpdatedAt}::text)::timestamptz
        RETURNING ${columns}
      `;
      if (row) return { kind: "updated", item: toItem(row) };

      const [exists] = await sql`SELECT 1 FROM access_applications WHERE id = ${id}::bigint`;
      return exists ? { kind: "conflict" } : { kind: "not_found" };
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
  };
}
