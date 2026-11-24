import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type postgres from "postgres";
import type { Database } from "@/lib/applications/db";
import type { PackageInfo } from "./store";

/**
 * Links sent once (issued since 0009) keep their token's and their session's SHA-256 under a key of their own.
 * Versions before 0009 look links up by the plain SHA-256 only, so after a rollback to one of them these links
 * open nothing (404) instead of being served by that version's rules (opened as the page loads, downloaded and
 * resumed until they close). The version that issued them finds them again once it is back.
 */
export const onceKey = (kind: "token" | "session", hash: Buffer) =>
  createHash("sha256").update(`nokka-install-${kind}-sent-once\n`).update(hash).digest();

/** A link the operator just issued. The token exists only here and in the URL handed to the person. */
export type IssuedInstallLink = { expiresAt: string; build: number; version: string };

/** `issueLinkIn`'s outcome: an issued link also names its row, for the approval mail that carries it. */
export type IssueInOutcome = Exclude<IssueOutcome, { kind: "issued" } | { kind: "not_found" }> | {
  kind: "issued";
  id: string;
  link: IssuedInstallLink;
};

export type IssueOutcome =
  | { kind: "issued"; link: IssuedInstallLink }
  | { kind: "not_found" }
  /** The request's updates are not allowed (as stored). */
  | { kind: "not_approved" }
  /** No installer is set, or it is no longer servable. */
  | { kind: "no_installer" };

export type RevokeOutcome = { kind: "revoked"; revoked: number } | { kind: "not_found" };

/** What a download through a link needs; `live` is false once it must be refused (410). */
export type ResolvedInstallLink = {
  id: string;
  /** The link's own download address and cookie name (not secret). */
  ref: string;
  live: boolean;
  version: string;
  expiresAt: string;
  info: PackageInfo;
  /** Issued since 0009: its package is sent once (see `startTransfer`). Older links download until they close. */
  singleTransfer: boolean;
  /** A single-transfer link whose one transfer has started: every later download is refused. */
  transferStarted: boolean;
};

export type ExchangeOutcome =
  /** This call consumed the token; `maxAge` is the link's remaining whole seconds (at least 1). */
  | { kind: "opened"; link: ResolvedInstallLink; maxAge: number }
  | { kind: "not_found" }
  /** Closed (as `live` is false), or less than a second left. The token stays unused. */
  | { kind: "gone" }
  /** Still open, but its token was already exchanged once: `link` names it, without any session. */
  | { kind: "used"; link: ResolvedInstallLink }
  /**
   * A single-transfer link opened by a request that did not come from the page's button (an /install page
   * from before 0009 opens links as soon as it loads). Nothing is consumed.
   */
  | { kind: "button_required" };

export type TransferOutcome =
  /** This call took the link's one transfer: send the package now. */
  | { kind: "started" }
  /** The transfer was taken before (by this or a concurrent request). */
  | { kind: "used" }
  /** Closed meanwhile (expiry, revocation, replacement, approval or package withdrawal). */
  | { kind: "gone" }
  /** The request's client went away before the transfer was taken: nothing was taken. */
  | { kind: "cancelled" };

export type InstallLinkStore = {
  /**
   * Revokes the request's open link (if any) and stores a new one (sent once) for the current installer, valid
   * for `ttlSeconds`, in one transaction that holds the request row like an approval change does. Approval mails
   * not yet handed to the mail service are cancelled: this link replaces theirs.
   */
  issue(applicationId: string, params: { tokenHash: Buffer; ttlSeconds: number }): Promise<IssueOutcome>;
  /**
   * Revokes the request's open link, and cancels its approval mails not yet handed to the mail service, in one
   * transaction holding the request row; `revoked` counts links that were still unexpired.
   */
  revoke(applicationId: string): Promise<RevokeOutcome>;
  /**
   * Opens the link once: if it is open and its token was never exchanged, stores `sessionHash` as its one
   * session and marks the token used, in one transaction holding the link row. Of concurrent calls with the
   * same token exactly one opens it; a call that fails or is refused leaves the token unused. `button` says
   * the request came from the page's button; without it a single-transfer link is not opened.
   */
  exchange(tokenHash: Buffer, sessionHash: Buffer, options?: { button?: boolean }): Promise<ExchangeOutcome>;
  /** Null for an unknown session. Approval, expiry, revocation and the package are read fresh. */
  resolveSession(sessionHash: Buffer): Promise<ResolvedInstallLink | null>;
  /**
   * Takes a single-transfer link's one transfer, judged once its row and its package's row are held: still open
   * (approval, expiry, revocation and package, by the clock at that moment) and not taken before. Counts the
   * download too. Takes nothing for a request whose `signal` aborted (its client went away) before the commit.
   */
  startTransfer(id: string, options?: { signal?: AbortSignal }): Promise<TransferOutcome>;
  /** Counts a download that started sending bytes (links that are not single-transfer). */
  recordDownload(id: string): Promise<void>;
};

type LinkRow = {
  id: string;
  ref: string;
  live: boolean;
  expiresAt: string;
  singleTransfer: boolean;
  transferStarted: boolean;
  build: number;
  version: string;
  byte_length: string;
  sha256: Buffer;
  chunk_size: number;
  chunk_count: number;
};

const toResolvedLink = (row: LinkRow): ResolvedInstallLink => ({
  id: row.id,
  ref: row.ref,
  live: row.live,
  version: row.version,
  expiresAt: row.expiresAt,
  info: {
    build: row.build,
    byteLength: Number(row.byte_length),
    sha256Hex: Buffer.from(row.sha256).toString("hex"),
    chunkSize: row.chunk_size,
    chunkCount: row.chunk_count,
  },
  singleTransfer: row.singleTransfer,
  transferStarted: row.transferStarted,
});

/**
 * Issues a single-transfer link for the request inside `tx`, which already holds the request row (FOR UPDATE),
 * as approval changes and registrations do: a withdrawal either committed before (the caller saw it) or waits
 * and then revokes the new link with the rest. Revokes the request's open link first. The caller checks the
 * approval it holds.
 */
export async function issueLinkIn(
  tx: postgres.TransactionSql,
  applicationId: string,
  { tokenHash, ttlSeconds }: { tokenHash: Buffer; ttlSeconds: number },
): Promise<IssueInOutcome> {
  // FOR SHARE of the channel row: the release tool holds it (FOR UPDATE) whenever it changes the installer
  // or withdraws a package, so that happens either before or after this.
  const [installer] = await tx<{ build: number; version: string }[]>`
    SELECT p.build, p.short_version AS version
    FROM update_channel c
    JOIN update_packages p ON p.build = c.installer_build
    WHERE c.id AND p.verified_at IS NOT NULL AND p.state <> 'withdrawn'
    FOR SHARE OF c
  `;
  if (!installer) return { kind: "no_installer" };
  await tx`
    UPDATE update_install_links SET revoked_at = now()
    WHERE application_id = ${applicationId}::bigint AND revoked_at IS NULL
  `;
  const [link] = await tx<{ id: string; expiresAt: string }[]>`
    INSERT INTO update_install_links (token_hash, ref, application_id, build, expires_at, single_transfer)
    VALUES (${onceKey("token", tokenHash)}, ${randomUUID()}::uuid, ${applicationId}::bigint, ${installer.build},
            now() + ${ttlSeconds}::int * interval '1 second', true)
    RETURNING id::text AS id, to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "expiresAt"
  `;
  return {
    kind: "issued",
    id: link.id,
    link: { expiresAt: link.expiresAt, build: installer.build, version: installer.version },
  };
}

/**
 * Cancels the request's approval mails that were never handed to the mail service (waiting, or claimed but not
 * yet sending), inside `tx`, which holds the request row: an attempt that prepared its link then stops at
 * `markSending`, and no later run takes it up again.
 */
async function cancelUnsentMails(tx: postgres.TransactionSql, applicationId: string, code: string) {
  await tx`
    UPDATE approval_mails SET state = 'cancelled', error_code = ${code}, finished_at = now()
    WHERE application_id = ${applicationId}::bigint
      AND (state = 'queued' OR (state = 'sending' AND send_started_at IS NULL))
  `;
}

/** Rolls back a transfer taken for a client that went away meanwhile. */
class TransferCancelled extends Error {}

export function createInstallLinkStore(sql: Database): InstallLinkStore {
  return {
    async issue(applicationId, params) {
      return sql.begin(async (tx): Promise<IssueOutcome> => {
        // The request row first, as approval changes and registrations lock it: a withdrawal either
        // commits before this (and is seen here) or waits and then revokes the new link with the rest.
        const [application] = await tx<{ approved: boolean }[]>`
          SELECT updates_approved AS approved FROM access_applications WHERE id = ${applicationId}::bigint FOR UPDATE
        `;
        if (!application) return { kind: "not_found" };
        if (!application.approved) return { kind: "not_approved" };
        const outcome = await issueLinkIn(tx, applicationId, params);
        if (outcome.kind !== "issued") return outcome;
        // This link replaces the one an approval mail not yet handed to the provider would carry: that mail is
        // not sent, so it can not replace this link afterwards. One already handed over carries a closed link.
        await cancelUnsentMails(tx, applicationId, "replaced_by_operator_link");
        return { kind: "issued", link: outcome.link };
      });
    },

    async revoke(applicationId) {
      return sql.begin(async (tx): Promise<RevokeOutcome> => {
        const [application] = await tx`
          SELECT 1 FROM access_applications WHERE id = ${applicationId}::bigint FOR UPDATE
        `;
        if (!application) return { kind: "not_found" };
        const rows = await tx<{ live: boolean }[]>`
          UPDATE update_install_links SET revoked_at = now()
          WHERE application_id = ${applicationId}::bigint AND revoked_at IS NULL
          RETURNING expires_at > now() AS live
        `;
        // An approval mail not yet handed to the provider would otherwise go out later (also once it is taken up
        // again as left behind) with a new link: revoked means no link reaches the person until the operator
        // sends or issues one again. One already handed over carries the link closed here.
        await cancelUnsentMails(tx, applicationId, "revoked_by_operator");
        return { kind: "revoked", revoked: rows.filter((row) => row.live).length };
      });
    },

    async exchange(tokenHash, sessionHash, { button = false } = {}) {
      return sql.begin(async (tx): Promise<ExchangeOutcome> => {
        // The link row first: another exchange of this token, and a revocation, replacement or approval
        // withdrawal (they all update this row), either commits first or waits for this transaction.
        const [locked] = await tx<{ id: string }[]>`
          SELECT id::text AS id FROM update_install_links
          WHERE (token_hash = ${tokenHash} AND NOT single_transfer)
             OR (token_hash = ${onceKey("token", tokenHash)} AND single_transfer)
          FOR UPDATE
        `;
        if (!locked) return { kind: "not_found" };
        // Then everything is judged as it is once the row is held, however long that took: a new statement
        // reads what has been committed since (approval and package included), and clock_timestamp() is
        // the time now, where now() would still be when the transaction began. The lifetime comes from the
        // same clock, so a token is only consumed for a cookie that lasts.
        const [row] = await tx<(LinkRow & { used: boolean; maxAge: number })[]>`
          SELECT l.id::text AS id, l.ref::text AS ref,
                 (l.revoked_at IS NULL AND l.expires_at > c.at AND a.updates_approved
                   AND p.verified_at IS NOT NULL AND p.state <> 'withdrawn') AS live,
                 l.exchanged_at IS NOT NULL AS used,
                 l.single_transfer AS "singleTransfer", l.transfer_started_at IS NOT NULL AS "transferStarted",
                 floor(extract(epoch FROM l.expires_at - c.at))::int AS "maxAge",
                 to_char(l.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "expiresAt",
                 p.build, p.short_version AS version, p.byte_length, p.sha256, p.chunk_size, p.chunk_count
          FROM update_install_links l
          CROSS JOIN (SELECT clock_timestamp() AS at) c
          JOIN access_applications a ON a.id = l.application_id
          JOIN update_packages p ON p.build = l.build
          WHERE l.id = ${locked.id}::bigint
        `;
        if (!row.live || row.maxAge < 1) return { kind: "gone" };
        if (row.used) return { kind: "used", link: toResolvedLink(row) };
        // Only the page's button opens these: a page that opens links as it loads (and anything that loads it,
        // like a mail scanner running it) leaves the token unused.
        if (row.singleTransfer && !button) return { kind: "button_required" };
        await tx`
          UPDATE update_install_links
          SET exchanged_at = clock_timestamp(), session_hash = ${row.singleTransfer ? onceKey("session", sessionHash) : sessionHash}
          WHERE id = ${row.id}::bigint
        `;
        return { kind: "opened", link: toResolvedLink(row), maxAge: row.maxAge };
      });
    },

    async resolveSession(sessionHash) {
      const [row] = await sql<LinkRow[]>`
        SELECT l.id::text AS id, l.ref::text AS ref,
               (l.revoked_at IS NULL AND l.expires_at > now() AND a.updates_approved
                 AND p.verified_at IS NOT NULL AND p.state <> 'withdrawn') AS live,
               l.single_transfer AS "singleTransfer", l.transfer_started_at IS NOT NULL AS "transferStarted",
               to_char(l.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "expiresAt",
               p.build, p.short_version AS version, p.byte_length, p.sha256, p.chunk_size, p.chunk_count
        FROM update_install_links l
        JOIN access_applications a ON a.id = l.application_id
        JOIN update_packages p ON p.build = l.build
        WHERE (l.session_hash = ${sessionHash} AND NOT l.single_transfer)
           OR (l.session_hash = ${onceKey("session", sessionHash)} AND l.single_transfer)
      `;
      return row ? toResolvedLink(row) : null;
    },

    async startTransfer(id, { signal } = {}) {
      try {
        return await sql.begin(async (tx): Promise<TransferOutcome> => {
          // The link row first, like the exchange: concurrent downloads, a revocation, a replacement and an
          // approval withdrawal (they all update this row) take turns. Then its package row, shared: the release
          // tool updates that row to withdraw the package, so a withdrawal commits before this (and is seen
          // below) or waits until this transfer is taken.
          const [link] = await tx<{ build: number }[]>`
            SELECT build FROM update_install_links WHERE id = ${id}::bigint FOR UPDATE
          `;
          if (!link) return { kind: "gone" };
          await tx`SELECT 1 FROM update_packages WHERE build = ${link.build} FOR SHARE`;
          // Its client went away while it waited: nobody would get the package.
          if (signal?.aborted) return { kind: "cancelled" };
          // Judged and taken in one statement, by what is committed and the clock at that moment.
          const taken = await tx`
            UPDATE update_install_links l
            SET transfer_started_at = clock_timestamp(), download_count = l.download_count + 1,
                last_download_at = clock_timestamp()
            FROM access_applications a, update_packages p
            WHERE l.id = ${id}::bigint AND a.id = l.application_id AND p.build = l.build
              AND l.single_transfer AND l.transfer_started_at IS NULL
              AND l.revoked_at IS NULL AND l.expires_at > clock_timestamp() AND a.updates_approved
              AND p.verified_at IS NOT NULL AND p.state <> 'withdrawn'
            RETURNING 1
          `;
          if (taken.length === 1) {
            // Gone before the commit: rolled back, so the transfer stays.
            if (signal?.aborted) throw new TransferCancelled();
            return { kind: "started" };
          }
          const [row] = await tx<{ live: boolean }[]>`
            SELECT l.revoked_at IS NULL AND l.expires_at > clock_timestamp() AND a.updates_approved
                   AND p.verified_at IS NOT NULL AND p.state <> 'withdrawn' AS live
            FROM update_install_links l
            JOIN access_applications a ON a.id = l.application_id
            JOIN update_packages p ON p.build = l.build
            WHERE l.id = ${id}::bigint
          `;
          return row.live ? { kind: "used" } : { kind: "gone" };
        });
      } catch (error) {
        if (error instanceof TransferCancelled) return { kind: "cancelled" };
        throw error;
      }
    },

    async recordDownload(id) {
      await sql`
        UPDATE update_install_links SET download_count = download_count + 1, last_download_at = now()
        WHERE id = ${id}::bigint
      `;
    },
  };
}
