import "server-only";
import { getDatabase, type Database } from "@/lib/applications/db";
import { decodeBase64url, sha256, TOKEN_BYTES } from "./crypto";

/**
 * The one access check for protected update responses (feed and packages). Call it for every GET,
 * HEAD and Range request before looking at any stored object or conditional header.
 */
export type UpdateAuthorization =
  | { ok: true; installationId: string; expiresAt: string }
  /** Missing, malformed, unknown or expired token: get a new session and retry once. */
  | { ok: false; status: 401; code: "INVALID_TOKEN" }
  /** Approval withdrawn or another Mac registered since: stop and ask to register again. */
  | { ok: false; status: 403; code: "REGISTRATION_INACTIVE" }
  /** Database missing or failing; never treated as a missing permission. */
  | { ok: false; status: 503; code: "UNAVAILABLE" };

export type UpdateAuthorizer = { authorize(token: string | null | undefined): Promise<UpdateAuthorization> };

const INVALID_TOKEN = { ok: false, status: 401, code: "INVALID_TOKEN" } as const;
const INACTIVE = { ok: false, status: 403, code: "REGISTRATION_INACTIVE" } as const;
const UNAVAILABLE = { ok: false, status: 503, code: "UNAVAILABLE" } as const;

/** The token of an `Authorization: Bearer <token>` header, or null. */
export function readBearerToken(headers: Headers): string | null {
  const match = /^Bearer ([A-Za-z0-9_-]+)$/i.exec(headers.get("authorization") ?? "");
  return match ? match[1] : null;
}

export function createUpdateAuthorizer(sql: Database): UpdateAuthorizer {
  return {
    async authorize(token) {
      if (!decodeBase64url(token, TOKEN_BYTES)) return INVALID_TOKEN;
      try {
        // One statement: approval, generation and the active installation are read fresh on every call.
        const [row] = await sql<{ installationId: string; expiresAt: string; live: boolean; active: boolean }[]>`
          SELECT s.installation_id::text AS "installationId",
                 to_char(s.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "expiresAt",
                 s.expires_at > now() AS live,
                 coalesce(
                   a.updates_approved
                     AND a.updates_generation = s.generation
                     AND a.active_installation_id = s.installation_id,
                   false
                 ) AS active
          FROM update_sessions s
          JOIN access_applications a ON a.id = s.application_id
          WHERE s.token_hash = ${sha256(token!)}
        `;
        if (!row || !row.live) return INVALID_TOKEN;
        if (!row.active) return INACTIVE;
        return { ok: true, installationId: row.installationId, expiresAt: row.expiresAt };
      } catch (error) {
        console.error("[updates] authorization failed", describeError(error));
        return UNAVAILABLE;
      }
    },
  };
}

/** Never throws. Uses DATABASE_URL; answers UNAVAILABLE while it is not set. */
export async function authorizeUpdates(token: string | null | undefined): Promise<UpdateAuthorization> {
  let sql: Database | null;
  try {
    sql = getDatabase();
  } catch (error) {
    console.error("[updates] database setup failed", describeError(error));
    return UNAVAILABLE;
  }
  if (!sql) return UNAVAILABLE;
  return createUpdateAuthorizer(sql).authorize(token);
}

function describeError(error: unknown) {
  if (!(error instanceof Error)) return { name: typeof error };
  const code = (error as { code?: unknown }).code;
  return { name: error.name, code: typeof code === "string" ? code : undefined };
}
