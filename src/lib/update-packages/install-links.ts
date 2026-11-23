import "server-only";
import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/applications/db";
import type { PackageInfo } from "./store";

/** A link the operator just issued. The token exists only here and in the URL handed to the person. */
export type IssuedInstallLink = { expiresAt: string; build: number; version: string };

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
};

export type ExchangeOutcome =
  /** This call consumed the token; `maxAge` is the link's remaining whole seconds (at least 1). */
  | { kind: "opened"; link: ResolvedInstallLink; maxAge: number }
  | { kind: "not_found" }
  /** Closed (as `live` is false), or less than a second left. The token stays unused. */
  | { kind: "gone" }
  /** Still open, but its token was already exchanged once: `link` names it, without any session. */
  | { kind: "used"; link: ResolvedInstallLink };

export type InstallLinkStore = {
  /**
   * Revokes the request's open link (if any) and stores a new one for the current installer, valid for
   * `ttlSeconds`, in one transaction that holds the request row like an approval change does.
   */
  issue(applicationId: string, params: { tokenHash: Buffer; ttlSeconds: number }): Promise<IssueOutcome>;
  /** Revokes the request's open link; `revoked` counts links that were still unexpired. */
  revoke(applicationId: string): Promise<RevokeOutcome>;
  /**
   * Opens the link once: if it is open and its token was never exchanged, stores `sessionHash` as its one
   * session and marks the token used, in one transaction holding the link row. Of concurrent calls with the
   * same token exactly one opens it; a call that fails or is refused leaves the token unused.
   */
  exchange(tokenHash: Buffer, sessionHash: Buffer): Promise<ExchangeOutcome>;
  /** Null for an unknown session. Approval, expiry, revocation and the package are read fresh. */
  resolveSession(sessionHash: Buffer): Promise<ResolvedInstallLink | null>;
  /** Counts a download that started sending bytes. */
  recordDownload(id: string): Promise<void>;
};

type LinkRow = {
  id: string;
  ref: string;
  live: boolean;
  expiresAt: string;
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
});

export function createInstallLinkStore(sql: Database): InstallLinkStore {
  return {
    async issue(applicationId, { tokenHash, ttlSeconds }) {
      return sql.begin(async (tx): Promise<IssueOutcome> => {
        // The request row first, as approval changes and registrations lock it: a withdrawal either
        // commits before this (and is seen here) or waits and then revokes the new link with the rest.
        const [application] = await tx<{ approved: boolean }[]>`
          SELECT updates_approved AS approved FROM access_applications WHERE id = ${applicationId}::bigint FOR UPDATE
        `;
        if (!application) return { kind: "not_found" };
        if (!application.approved) return { kind: "not_approved" };
        // FOR SHARE of the channel row: the release tool holds it (FOR UPDATE) whenever it changes the
        // installer or withdraws a package, so that happens either before or after this.
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
        const [link] = await tx<{ expiresAt: string }[]>`
          INSERT INTO update_install_links (token_hash, ref, application_id, build, expires_at)
          VALUES (${tokenHash}, ${randomUUID()}::uuid, ${applicationId}::bigint, ${installer.build},
                  now() + ${ttlSeconds}::int * interval '1 second')
          RETURNING to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "expiresAt"
        `;
        return { kind: "issued", link: { expiresAt: link.expiresAt, build: installer.build, version: installer.version } };
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
        return { kind: "revoked", revoked: rows.filter((row) => row.live).length };
      });
    },

    async exchange(tokenHash, sessionHash) {
      return sql.begin(async (tx): Promise<ExchangeOutcome> => {
        // The link row first: another exchange of this token, and a revocation, replacement or approval
        // withdrawal (they all update this row), either commits first or waits for this transaction.
        const [locked] = await tx<{ id: string }[]>`
          SELECT id::text AS id FROM update_install_links WHERE token_hash = ${tokenHash} FOR UPDATE
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
        await tx`
          UPDATE update_install_links SET exchanged_at = clock_timestamp(), session_hash = ${sessionHash}
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
               to_char(l.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "expiresAt",
               p.build, p.short_version AS version, p.byte_length, p.sha256, p.chunk_size, p.chunk_count
        FROM update_install_links l
        JOIN access_applications a ON a.id = l.application_id
        JOIN update_packages p ON p.build = l.build
        WHERE l.session_hash = ${sessionHash}
      `;
      return row ? toResolvedLink(row) : null;
    },

    async recordDownload(id) {
      await sql`
        UPDATE update_install_links SET download_count = download_count + 1, last_download_at = now()
        WHERE id = ${id}::bigint
      `;
    },
  };
}
