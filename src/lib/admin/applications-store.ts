import "server-only";
import type { Database } from "@/lib/applications/db";
import { APPROVAL_MAIL_STALE_SECONDS } from "./approval-mail-store";
import type { AdminApplication, ApprovalMail, ApprovalMailStatus, ApplicationStatus, CodeMail, StatusFilter } from "./contracts";

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
  /** `approvalMailId`: the approval mail this save stored (it turned updates on), to be sent after the commit. */
  | { kind: "updated"; item: AdminApplication; approvalMailId: string | null }
  | { kind: "not_found" }
  | { kind: "conflict" };

export type AdminApplicationsStore = {
  search(params: SearchParams): Promise<{ items: AdminApplication[]; nextCursor: SearchCursor | null }>;
  update(id: string, params: UpdateParams): Promise<UpdateOutcome>;
  /** One request as the inbox shows it, or null. */
  get(id: string): Promise<AdminApplication | null>;
};

type Row = {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  status: ApplicationStatus;
  operatorNote: string;
  lastContactedAt: string | null;
  updatedAt: string;
  updatesApproved: boolean;
  macRegistered: boolean;
  codeMailRequestedAt: string | null;
  codeMailStatus: CodeMail["status"] | null;
  mailId: string | null;
  mailTrigger: ApprovalMail["trigger"] | null;
  mailStatus: ApprovalMailStatus | null;
  mailErrorCode: string | null;
  mailCreatedAt: string | null;
  mailSendStartedAt: string | null;
  mailFinishedAt: string | null;
  mailLinkExpiresAt: string | null;
  mailLinkState: ApprovalMail["linkState"];
  cursorCreatedAt: string;
};

export function createAdminApplicationsStore(sql: Database): AdminApplicationsStore {
  // Millisecond UTC ISO strings for the API; the cursor keeps microseconds so paging never skips rows.
  // Timestamps go in as text and are cast in SQL: a timestamptz parameter would pass through a JS Date
  // and lose the microseconds.
  const stale = sql`now() - ${APPROVAL_MAIL_STALE_SECONDS}::int * interval '1 second'`;

  // The request plus, read in one go for the whole page: whether a Mac is registered (never which), its latest
  // code mail (when and how the mail service answered, never the code or the Mac) and its latest approval mail.
  // A claimed mail that never asked the mail service and is stale reads as interrupted, one that asked and
  // never recorded the answer as uncertain.
  const selectItems = sql`
    SELECT
      a.id::text AS id,
      a.name,
      a.email,
      to_char(a.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt",
      a.status,
      a.operator_note AS "operatorNote",
      to_char(a.last_contacted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "lastContactedAt",
      to_char(a.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "updatedAt",
      a.updates_approved AS "updatesApproved",
      a.active_installation_id IS NOT NULL AS "macRegistered",
      to_char(c.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "codeMailRequestedAt",
      c.mail_status AS "codeMailStatus",
      m.id::text AS "mailId",
      m.trigger AS "mailTrigger",
      CASE
        WHEN m.state = 'sending' AND m.send_started_at IS NOT NULL AND m.send_started_at < ${stale} THEN 'uncertain'
        WHEN m.state = 'sending' AND m.send_started_at IS NULL AND m.claimed_at < ${stale} THEN 'interrupted'
        WHEN m.state = 'queued' AND m.created_at < ${stale} THEN 'interrupted'
        ELSE m.state
      END AS "mailStatus",
      CASE
        WHEN m.state = 'sending' AND m.send_started_at IS NOT NULL AND m.send_started_at < ${stale} THEN 'result_not_recorded'
        ELSE m.error_code
      END AS "mailErrorCode",
      to_char(m.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "mailCreatedAt",
      to_char(m.send_started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "mailSendStartedAt",
      to_char(m.finished_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "mailFinishedAt",
      to_char(l.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "mailLinkExpiresAt",
      CASE
        WHEN l.id IS NULL THEN NULL
        WHEN l.revoked_at IS NOT NULL THEN 'closed'
        WHEN l.transfer_started_at IS NOT NULL OR l.download_count > 0 THEN 'downloaded'
        WHEN l.expires_at <= now() THEN 'expired'
        ELSE 'open'
      END AS "mailLinkState",
      to_char(a.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorCreatedAt"
    FROM access_applications a
    LEFT JOIN LATERAL (
      SELECT created_at, mail_status FROM update_challenges
      WHERE application_id = a.id ORDER BY created_at DESC LIMIT 1
    ) c ON true
    LEFT JOIN LATERAL (
      SELECT * FROM approval_mails WHERE application_id = a.id ORDER BY id DESC LIMIT 1
    ) m ON true
    LEFT JOIN update_install_links l ON l.id = m.install_link_id
  `;

  return {
    async search({ q, status, cursor, limit }) {
      const pattern = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
      const rows = await sql<Row[]>`
        ${selectItems}
        WHERE true
          ${status === "all" ? sql`` : sql`AND a.status = ${status}`}
          ${q ? sql`AND (a.name ILIKE ${pattern} ESCAPE '\\' OR a.email ILIKE ${pattern} ESCAPE '\\')` : sql``}
          ${cursor ? sql`AND (a.created_at, a.id) < ((${cursor.createdAt}::text)::timestamptz, ${cursor.id}::bigint)` : sql``}
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT ${limit + 1}
      `;
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        items: page.map(toItem),
        nextCursor: rows.length > limit && last ? { createdAt: last.cursorCreatedAt, id: last.id } : null,
      };
    },

    async get(id) {
      const [row] = await sql<Row[]>`${selectItems} WHERE a.id = ${id}::bigint`;
      return row ? toItem(row) : null;
    },

    async update(id, { status, operatorNote, updatesApproved, expectedUpdatedAt }) {
      const approved = updatesApproved ?? null;
      return sql.begin(async (tx): Promise<UpdateOutcome> => {
        // The row lock that update registrations and install links take first (then their codes, links and
        // mails), so a withdrawal and a registration or mail in flight are applied one after the other. It
        // also fixes what the approval was before this save, to tell a real change from saving the same value.
        const [before] = await tx<{ approved: boolean }[]>`
          SELECT updates_approved AS approved FROM access_applications WHERE id = ${id}::bigint FOR UPDATE
        `;
        if (!before) return { kind: "not_found" };
        // The token comparison and the write are one statement, so they cannot interleave with another save.
        const [row] = await tx<{ generation: string }[]>`
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
          RETURNING updates_generation::text AS generation
        `;
        if (!row) return { kind: "conflict" };

        let approvalMailId: string | null = null;
        if (approved === false && before.approved) {
          // Withdrawn: the registered Mac (pointer cleared above), its sessions (new generation), unused
          // codes, the open install link and an approval mail not yet handed to the mail service all end in
          // this transaction. One already handed over carries a link that no longer opens. Turning it back
          // on later needs a new code (and sends a new link).
          await tx`UPDATE update_challenges SET state = 'void' WHERE application_id = ${id}::bigint AND state = 'pending'`;
          await tx`UPDATE update_install_links SET revoked_at = now() WHERE application_id = ${id}::bigint AND revoked_at IS NULL`;
          await tx`
            UPDATE approval_mails SET state = 'cancelled', error_code = 'approval_withdrawn', finished_at = now()
            WHERE application_id = ${id}::bigint
              AND (state = 'queued' OR (state = 'sending' AND send_started_at IS NULL))
          `;
        } else if (approved === true && !before.approved) {
          // Turned on: one approval mail, stored with the change and sent after the commit. Keyed by the new
          // generation, so this change can never store a second one.
          const [mail] = await tx<{ id: string }[]>`
            INSERT INTO approval_mails (application_id, generation, trigger)
            VALUES (${id}::bigint, ${row.generation}::bigint, 'approval')
            ON CONFLICT (application_id, generation) WHERE trigger = 'approval' DO NOTHING
            RETURNING id::text AS id
          `;
          approvalMailId = mail?.id ?? null;
        }
        const [item] = await tx<Row[]>`${selectItems} WHERE a.id = ${id}::bigint`;
        return { kind: "updated", item: toItem(item), approvalMailId };
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
    macRegistered: row.macRegistered,
    latestCodeMail:
      row.codeMailRequestedAt && row.codeMailStatus
        ? { requestedAt: row.codeMailRequestedAt, status: row.codeMailStatus }
        : null,
    approvalMail:
      row.mailId && row.mailTrigger && row.mailStatus && row.mailCreatedAt
        ? {
            id: row.mailId,
            trigger: row.mailTrigger,
            status: row.mailStatus,
            errorCode: row.mailErrorCode,
            createdAt: row.mailCreatedAt,
            sendStartedAt: row.mailSendStartedAt,
            finishedAt: row.mailFinishedAt,
            linkExpiresAt: row.mailLinkExpiresAt,
            linkState: row.mailLinkState,
          }
        : null,
  };
}
