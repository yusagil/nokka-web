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

export type InstallLinkStore = {
  /**
   * Revokes the request's open link (if any) and stores a new one for the current installer, valid for
   * `ttlSeconds`, in one transaction that holds the request row like an approval change does.
   */
  issue(applicationId: string, params: { tokenHash: Buffer; ttlSeconds: number }): Promise<IssueOutcome>;
  /** Revokes the request's open link; `revoked` counts links that were still unexpired. */
  revoke(applicationId: string): Promise<RevokeOutcome>;
  /** Null for an unknown token. Approval, expiry, revocation and the package are read fresh. */
  resolve(tokenHash: Buffer): Promise<ResolvedInstallLink | null>;
  /** Counts a download that started sending bytes. */
  recordDownload(id: string): Promise<void>;
};

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

    async resolve(tokenHash) {
      const [row] = await sql<
        {
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
        }[]
      >`
        SELECT l.id::text AS id, l.ref::text AS ref,
               (l.revoked_at IS NULL AND l.expires_at > now() AND a.updates_approved
                 AND p.verified_at IS NOT NULL AND p.state <> 'withdrawn') AS live,
               to_char(l.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "expiresAt",
               p.build, p.short_version AS version, p.byte_length, p.sha256, p.chunk_size, p.chunk_count
        FROM update_install_links l
        JOIN access_applications a ON a.id = l.application_id
        JOIN update_packages p ON p.build = l.build
        WHERE l.token_hash = ${tokenHash}
      `;
      if (!row) return null;
      return {
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
      };
    },

    async recordDownload(id) {
      await sql`
        UPDATE update_install_links SET download_count = download_count + 1, last_download_at = now()
        WHERE id = ${id}::bigint
      `;
    },
  };
}
