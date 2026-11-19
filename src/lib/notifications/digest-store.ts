import "server-only";
import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import type { Database } from "@/lib/applications/db";

export type DigestBatch = {
  id: string;
  /** Fixed when the batch is formed; the mail always reports this number. */
  count: number;
  /** Claim number: a fencing token so a sender whose lease expired cannot overwrite a newer claim. */
  attempt: number;
  /** An earlier send of this batch may already have arrived, so sending it again can repeat it. */
  mayRepeat: boolean;
};

export type DigestClaim =
  | { kind: "send"; batch: DigestBatch }
  | { kind: "skipped"; reason: "empty" | "already_sent_today" | "attempted_today" }
  /** Another call is forming a batch or holds a live lease. */
  | { kind: "busy" };

export type DigestStore = {
  /** Locks out other calls, then leases the unfinished batch or forms a new one, in one short transaction. */
  claim(): Promise<DigestClaim>;
  /** Records the day's single send attempt; call it right before sending. False means: do not send. */
  markSendAttempt(batch: DigestBatch): Promise<boolean>;
  /** Each returns false when the claim was taken over after its lease expired. */
  markSent(batch: DigestBatch, messageId: string): Promise<boolean>;
  /** Nothing of this batch has arrived yet; the next day's call sends it. */
  markFailed(batch: DigestBatch, errorCode: string): Promise<boolean>;
  /** A send of this batch may have arrived; the next day's call sends it again. */
  markUnknown(batch: DigestBatch, errorCode: string): Promise<boolean>;
};

export type DigestStoreOptions = {
  /** Must outlast one call's token requests and send (the route allows 60 seconds). */
  leaseSeconds?: number;
};

/** "Today" for the one-digest and one-send-attempt-a-day rules. */
export const DIGEST_TIME_ZONE = "Asia/Seoul";

type OpenRun = {
  id: string;
  status: "sending" | "failed" | "unknown";
  application_count: number;
  attempts: number;
  leased: boolean;
  ever_attempted: boolean;
  attempted_today: boolean;
};

// The 0003 columns idempotency_key and idempotency_key_used_at stay NULL: Gmail has no such key.
// first_attempted_at / last_attempted_at are the first and latest actual send requests.
export function createDigestStore(sql: Database, { leaseSeconds = 300 }: DigestStoreOptions = {}): DigestStore {
  async function finish(batch: DigestBatch, status: "failed" | "unknown", errorCode: string) {
    const updated = await sql`
      UPDATE application_digest_runs
      SET status = ${status}, error_code = ${errorCode}, lease_expires_at = NULL
      WHERE id = ${batch.id} AND status = 'sending' AND attempts = ${batch.attempt}
    `;
    return updated.count === 1;
  }

  async function claimOpenRun(tx: postgres.TransactionSql, open: OpenRun): Promise<DigestClaim> {
    if (open.status === "sending" && open.leased) return { kind: "busy" };
    // At most one send request per batch per day, also across repeated or duplicate cron calls.
    if (open.attempted_today) return { kind: "skipped", reason: "attempted_today" };

    const attempt = open.attempts + 1;
    await tx`
      UPDATE application_digest_runs
      SET status = 'sending', attempts = ${attempt},
          lease_expires_at = now() + make_interval(secs => ${leaseSeconds})
      WHERE id = ${open.id}
    `;
    // An expired "sending" lease after a send request is as uncertain as "unknown".
    const mayRepeat = open.status === "unknown" || (open.status === "sending" && open.ever_attempted);
    return { kind: "send", batch: { id: open.id, count: open.application_count, attempt, mayRepeat } };
  }

  return {
    claim() {
      return sql.begin(async (tx): Promise<DigestClaim> => {
        // Transaction-scoped, so it also works through a transaction-mode pooler.
        const [{ locked }] = await tx`
          SELECT pg_try_advisory_xact_lock(hashtext('nokka.application_digest')) AS locked
        `;
        if (!locked) return { kind: "busy" };

        const [{ today_start }] = await tx`
          SELECT date_trunc('day', now() AT TIME ZONE ${DIGEST_TIME_ZONE}) AT TIME ZONE ${DIGEST_TIME_ZONE}
            AS today_start
        `;
        const [open] = await tx<OpenRun[]>`
          SELECT id, status, application_count, attempts,
                 coalesce(lease_expires_at > now(), false) AS leased,
                 last_attempted_at IS NOT NULL AS ever_attempted,
                 coalesce(last_attempted_at >= ${today_start}, false) AS attempted_today
          FROM application_digest_runs
          WHERE status IN ('sending', 'failed', 'unknown')
          FOR UPDATE
        `;
        if (open) return claimOpenRun(tx, open);

        const [{ sent_today }] = await tx`
          SELECT EXISTS (
            SELECT 1 FROM application_digest_runs WHERE status = 'sent' AND sent_at >= ${today_start}
          ) AS sent_today
        `;
        if (sent_today) return { kind: "skipped", reason: "already_sent_today" };

        const id = randomUUID();
        await tx`
          INSERT INTO application_digest_runs (id, status, application_count, attempts, lease_expires_at)
          VALUES (${id}, 'sending', 0, 1, now() + make_interval(secs => ${leaseSeconds}))
        `;
        // Every committed request not yet in a batch. Requests committed later wait for the next
        // batch; the primary key keeps a request from ever joining two batches.
        const { count } = await tx`
          INSERT INTO application_digest_items (application_id, run_id)
          SELECT a.id, ${id}::uuid FROM access_applications a
          WHERE NOT EXISTS (SELECT 1 FROM application_digest_items i WHERE i.application_id = a.id)
        `;
        if (count === 0) {
          await tx`
            UPDATE application_digest_runs SET status = 'skipped', attempts = 0, lease_expires_at = NULL
            WHERE id = ${id}
          `;
          return { kind: "skipped", reason: "empty" };
        }
        await tx`UPDATE application_digest_runs SET application_count = ${count} WHERE id = ${id}`;
        return { kind: "send", batch: { id, count, attempt: 1, mayRepeat: false } };
      });
    },

    async markSendAttempt(batch) {
      const updated = await sql`
        UPDATE application_digest_runs
        SET last_attempted_at = now(), first_attempted_at = coalesce(first_attempted_at, now())
        WHERE id = ${batch.id} AND status = 'sending' AND attempts = ${batch.attempt}
          AND lease_expires_at > now()
      `;
      return updated.count === 1;
    },

    async markSent(batch, messageId) {
      const updated = await sql`
        UPDATE application_digest_runs
        SET status = 'sent', sent_at = now(), provider_message_id = ${messageId},
            error_code = NULL, lease_expires_at = NULL
        WHERE id = ${batch.id} AND status = 'sending' AND attempts = ${batch.attempt}
      `;
      return updated.count === 1;
    },

    markFailed: (batch, errorCode) => finish(batch, "failed", errorCode),
    markUnknown: (batch, errorCode) => finish(batch, "unknown", errorCode),
  };
}
