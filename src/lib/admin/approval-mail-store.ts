import "server-only";
import type { Database } from "@/lib/applications/db";
import type { SendResult } from "@/lib/notifications/mailer";
import { issueLinkIn, type IssuedInstallLink } from "@/lib/update-packages/install-links";

/**
 * After this long a claimed mail that never asked the mail service is taken as interrupted (nothing sent) and
 * may be claimed again, and one that asked without recording the answer is taken as uncertain. Far longer than
 * one attempt can take (two short provider requests and a few statements).
 */
export const APPROVAL_MAIL_STALE_SECONDS = 120;

/** One attempt at one mail. Every write names its attempt, so a stalled attempt can not overwrite a newer one. */
export type MailClaim = { id: string; attempt: number };

export type PreparedMail =
  /** The new link is stored for this mail; its token exists only in the caller. */
  | { kind: "ready"; to: string; name: string; link: IssuedInstallLink }
  /** Not this attempt's to send any more (withdrawn, replaced, or claimed again): nothing to do. */
  | { kind: "stopped" }
  /** Recorded as failed; nothing will be sent. */
  | { kind: "failed"; code: "no_installer" };

export type MailRequestOutcome =
  | { kind: "claimed"; claim: MailClaim }
  | { kind: "not_found" }
  | { kind: "not_approved" }
  /** The latest mail is not the one the operator saw. */
  | { kind: "conflict" }
  /** The latest mail is being sent right now. */
  | { kind: "in_progress" };

export type ApprovalMailStore = {
  /** Claims a stored mail nobody claimed yet; null when it was claimed, cancelled or finished. */
  claim(id: string): Promise<MailClaim | null>;
  /**
   * Claims up to `limit` mails that were never sent and were left behind: unclaimed for a while, handed back by
   * an attempt that ran out of time, or claimed by an attempt that stopped before asking.
   */
  claimLeftBehind(limit: number): Promise<MailClaim[]>;
  /**
   * In one transaction holding the request row: checks that this attempt still owns the latest mail of a
   * request that is still allowed, then issues the link it carries (replacing the request's open link).
   */
  prepare(claim: MailClaim, params: { tokenHash: Buffer; ttlSeconds: number }): Promise<PreparedMail>;
  /**
   * Records, and commits, that the mail service is about to be asked, if this attempt still owns the latest
   * mail of an allowed request and its link still opens (not revoked or expired, its package not withdrawn).
   * False: send nothing, and the attempt has ended (cancelled, or failed when the package was withdrawn). Once
   * true, the mail may go out whatever happens next, so it is never sent again automatically. `inTime`, asked
   * once the rows are held: false hands the mail back unsent (waiting, claimable again at once) instead, for a
   * caller whose time ran out while it waited for them.
   */
  markSending(claim: MailClaim, options?: { inTime?: () => boolean }): Promise<boolean>;
  /** Records the mail service's answer for this attempt only; a refusal also closes the mail's link. */
  finish(claim: MailClaim, result: SendResult): Promise<void>;
  /** Records that this attempt stopped before the mail service was asked. */
  fail(claim: MailClaim, code: string): Promise<void>;
  /**
   * The operator's request, checked against the latest mail the card showed (`expectedMailId`, null: none):
   * `send` claims a mail that was never handed to the mail service (waiting or interrupted; with null, stores the
   * first one); `resend` stores a new mail (a new link replaces the old one when it is sent) after a finished
   * one. Any other combination is a card that is out of date (`conflict`), so a repeated or late request never
   * sends a second mail.
   */
  request(applicationId: string, expectedMailId: string | null, intent: MailRequestIntent): Promise<MailRequestOutcome>;
};

/** send: a mail that was never sent goes now. resend: a finished mail is followed by a new one. */
export type MailRequestIntent = "send" | "resend";

const STALE = APPROVAL_MAIL_STALE_SECONDS;

/**
 * Every write that decides about a mail takes the request row first and the mail rows second, as approval
 * changes and install link issuing do, so they take turns and can not deadlock.
 */
export function createApprovalMailStore(sql: Database): ApprovalMailStore {
  const claimed = (rows: { id: string; attempts: number }[]) => rows.map((row) => ({ id: row.id, attempt: row.attempts }));

  return {
    async claim(id) {
      const rows = await sql<{ id: string; attempts: number }[]>`
        UPDATE approval_mails SET state = 'sending', attempts = attempts + 1, claimed_at = now()
        WHERE id = ${id}::bigint AND state = 'queued'
        RETURNING id::text AS id, attempts
      `;
      return claimed(rows)[0] ?? null;
    },

    async claimLeftBehind(limit) {
      const rows = await sql<{ id: string; attempts: number }[]>`
        UPDATE approval_mails SET state = 'sending', attempts = attempts + 1, claimed_at = now()
        WHERE id IN (
          SELECT id FROM approval_mails
          -- A waiting mail already attempted is not its save's own any more: it is taken at once.
          WHERE (state = 'queued' AND (attempts > 0 OR created_at < now() - ${STALE}::int * interval '1 second'))
             OR (state = 'sending' AND send_started_at IS NULL AND claimed_at < now() - ${STALE}::int * interval '1 second')
          ORDER BY id
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        )
        AND (state = 'queued' OR (state = 'sending' AND send_started_at IS NULL))
        RETURNING id::text AS id, attempts
      `;
      return claimed(rows);
    },

    async prepare(claim, params) {
      return sql.begin(async (tx): Promise<PreparedMail> => {
        const [mail] = await tx<{ applicationId: string }[]>`
          SELECT application_id::text AS "applicationId" FROM approval_mails WHERE id = ${claim.id}::bigint
        `;
        if (!mail) return { kind: "stopped" };
        const [application] = await tx<{ email: string; name: string; approved: boolean }[]>`
          SELECT email, name, updates_approved AS approved FROM access_applications
          WHERE id = ${mail.applicationId}::bigint FOR UPDATE
        `;
        const [current] = await tx<{ owned: boolean; superseded: boolean }[]>`
          SELECT state = 'sending' AND attempts = ${claim.attempt} AND send_started_at IS NULL AS owned,
                 EXISTS (SELECT 1 FROM approval_mails n WHERE n.application_id = m.application_id AND n.id > m.id) AS superseded
          FROM approval_mails m WHERE id = ${claim.id}::bigint FOR UPDATE
        `;
        if (!application || !current?.owned) return { kind: "stopped" };
        const stop = async (state: "cancelled" | "failed", code: string) => {
          await tx`
            UPDATE approval_mails SET state = ${state}, error_code = ${code}, finished_at = now()
            WHERE id = ${claim.id}::bigint
          `;
        };
        // A newer mail (a withdrawal and a new approval, or the operator's) is the one to send.
        if (current.superseded) {
          await stop("cancelled", "superseded");
          return { kind: "stopped" };
        }
        if (!application.approved) {
          await stop("cancelled", "approval_withdrawn");
          return { kind: "stopped" };
        }
        const issued = await issueLinkIn(tx, mail.applicationId, params);
        if (issued.kind === "no_installer") {
          await stop("failed", "no_installer");
          return { kind: "failed", code: "no_installer" };
        }
        if (issued.kind !== "issued") return { kind: "stopped" };
        await tx`UPDATE approval_mails SET install_link_id = ${issued.id}::bigint WHERE id = ${claim.id}::bigint`;
        return { kind: "ready", to: application.email, name: application.name, link: issued.link };
      });
    },

    async markSending(claim, { inTime } = {}) {
      return sql.begin(async (tx) => {
        const [mail] = await tx<{ applicationId: string }[]>`
          SELECT application_id::text AS "applicationId" FROM approval_mails WHERE id = ${claim.id}::bigint
        `;
        if (!mail) return false;
        // Holds the approval as it is: a withdrawal waits until this is committed (and then closes the link
        // this mail carries), or committed before and is seen here.
        await tx`SELECT 1 FROM access_applications WHERE id = ${mail.applicationId}::bigint FOR SHARE`;
        // And the package: the release tool holds the channel row (FOR UPDATE) while it withdraws one.
        await tx`SELECT 1 FROM update_channel WHERE id FOR SHARE`;
        const [check] = await tx<{ owned: boolean; approved: boolean; superseded: boolean; linkOpen: boolean; servable: boolean }[]>`
          SELECT m.state = 'sending' AND m.attempts = ${claim.attempt} AND m.send_started_at IS NULL AS owned,
                 a.updates_approved AS approved,
                 EXISTS (SELECT 1 FROM approval_mails n WHERE n.application_id = m.application_id AND n.id > m.id) AS superseded,
                 coalesce(l.revoked_at IS NULL, false) AS "linkOpen",
                 coalesce(l.expires_at > clock_timestamp() AND p.verified_at IS NOT NULL AND p.state <> 'withdrawn', false) AS servable
          FROM approval_mails m
          JOIN access_applications a ON a.id = m.application_id
          LEFT JOIN update_install_links l ON l.id = m.install_link_id
          LEFT JOIN update_packages p ON p.build = l.build
          WHERE m.id = ${claim.id}::bigint
          FOR UPDATE OF m
        `;
        if (!check?.owned) return false;
        // The rows may have taken long to get: a caller out of time hands the mail back, never asked.
        if (inTime && !inTime()) {
          await tx`UPDATE approval_mails SET state = 'queued', claimed_at = NULL WHERE id = ${claim.id}::bigint`;
          return false;
        }
        if (check.approved && !check.superseded && check.linkOpen && check.servable) {
          await tx`UPDATE approval_mails SET send_started_at = clock_timestamp() WHERE id = ${claim.id}::bigint`;
          return true;
        }
        // Still this attempt's, but it can not go out: it ends here, so no recovery run claims it again and issues
        // a link the operator closed. A withdrawn package (or a link past its expiry) is a failure the operator can
        // send again once an installer is set; the rest were decided by someone else.
        const [state, code] = !check.approved
          ? ["cancelled", "approval_withdrawn"]
          : check.superseded
            ? ["cancelled", "superseded"]
            : !check.linkOpen
              ? ["cancelled", "link_revoked"]
              : ["failed", "installer_withdrawn"];
        await tx`
          UPDATE approval_mails SET state = ${state}, error_code = ${code}, finished_at = now()
          WHERE id = ${claim.id}::bigint
        `;
        return false;
      });
    },

    async finish(claim, result) {
      const code = result.outcome === "accepted" ? null : result.code.slice(0, 100);
      await sql.begin(async (tx) => {
        // Also over the "result not recorded" a later request wrote while this answer was on its way.
        const [mail] = await tx<{ linkId: string | null }[]>`
          UPDATE approval_mails SET state = ${result.outcome}, error_code = ${code}, finished_at = now()
          WHERE id = ${claim.id}::bigint AND attempts = ${claim.attempt} AND send_started_at IS NOT NULL
            AND (state = 'sending' OR (state = 'uncertain' AND error_code = 'result_not_recorded'))
          RETURNING install_link_id::text AS "linkId"
        `;
        // Nothing was sent: the link it carried reaches nobody, so it is closed.
        if (mail?.linkId && result.outcome === "rejected") {
          await tx`UPDATE update_install_links SET revoked_at = now() WHERE id = ${mail.linkId}::bigint AND revoked_at IS NULL`;
        }
      });
    },

    async fail(claim, code) {
      await sql`
        UPDATE approval_mails SET state = 'failed', error_code = ${code.slice(0, 100)}, finished_at = now()
        WHERE id = ${claim.id}::bigint AND attempts = ${claim.attempt} AND state = 'sending' AND send_started_at IS NULL
      `;
    },

    async request(applicationId, expectedMailId, intent) {
      return sql.begin(async (tx): Promise<MailRequestOutcome> => {
        const [application] = await tx<{ approved: boolean; generation: string }[]>`
          SELECT updates_approved AS approved, updates_generation::text AS generation
          FROM access_applications WHERE id = ${applicationId}::bigint FOR UPDATE
        `;
        if (!application) return { kind: "not_found" };
        if (!application.approved) return { kind: "not_approved" };
        // Ordered by the bigint column itself: the text alias would put mail 9 after mail 10.
        const [latest] = await tx<{ id: string; state: string; started: boolean; stale: boolean }[]>`
          SELECT m.id::text AS id, m.state, m.send_started_at IS NOT NULL AS started,
                 coalesce(m.send_started_at, m.claimed_at, m.created_at) < now() - ${STALE}::int * interval '1 second' AS stale
          FROM approval_mails m WHERE m.application_id = ${applicationId}::bigint
          ORDER BY m.id DESC LIMIT 1 FOR UPDATE
        `;
        if ((latest?.id ?? null) !== expectedMailId) return { kind: "conflict" };

        const sending = latest?.state === "queued" || latest?.state === "sending";
        const waiting = latest && (latest.state === "queued" || (latest.state === "sending" && !latest.started && latest.stale));
        if (sending && !waiting && !latest?.stale) return { kind: "in_progress" };
        // `send` is only for a mail that never went out (or none yet), `resend` only after a finished one.
        if (intent === "send" ? latest && !waiting : !latest || waiting) return { kind: "conflict" };

        if (latest && waiting) {
          const [row] = await tx<{ id: string; attempts: number }[]>`
            UPDATE approval_mails SET state = 'sending', attempts = attempts + 1, claimed_at = now()
            WHERE id = ${latest.id}::bigint
            RETURNING id::text AS id, attempts
          `;
          return { kind: "claimed", claim: { id: row.id, attempt: row.attempts } };
        }
        if (latest?.state === "sending") {
          // Asked the mail service long ago and never recorded the answer.
          await tx`
            UPDATE approval_mails SET state = 'uncertain', error_code = 'result_not_recorded', finished_at = now()
            WHERE id = ${latest.id}::bigint
          `;
        }
        const [row] = await tx<{ id: string; attempts: number }[]>`
          INSERT INTO approval_mails (application_id, generation, trigger, state, attempts, claimed_at)
          VALUES (${applicationId}::bigint, ${application.generation}::bigint, 'manual', 'sending', 1, now())
          RETURNING id::text AS id, attempts
        `;
        return { kind: "claimed", claim: { id: row.id, attempt: row.attempts } };
      });
    },
  };
}
