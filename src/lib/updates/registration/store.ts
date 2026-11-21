import "server-only";
import { randomUUID, timingSafeEqual } from "node:crypto";
import type { Database } from "@/lib/applications/db";
import type { SendResult } from "@/lib/notifications/mailer";
import {
  CODE_MAX_FAILED_ATTEMPTS,
  CODE_REISSUE_SECONDS,
  CODE_TTL_SECONDS,
  SESSION_TTL_SECONDS,
} from "./contracts";
import { generateCode, keyedDigest } from "./crypto";

/** Hourly caps on issued challenges; requests beyond them are answered the same way but send nothing. */
export const CHALLENGES_PER_EMAIL_PER_HOUR = 5;
export const CHALLENGES_PER_INSTALLATION_PER_HOUR = 10;

export type ChallengeInput = {
  /** Trimmed and validated. Only used to look up the request and to key counters (as an HMAC). */
  email: string;
  installationId: string;
  publicKey: Buffer;
};

/** A code to mail once the challenge is committed; `to` is the stored address of the allowed request. */
export type CodeDelivery = { to: string; code: string };

export type IssueOutcome = {
  challengeId: string;
  expiresAt: string;
  /** Only for a new challenge of an allowed request. */
  delivery: CodeDelivery | null;
};

export type ChallengeRecord = { applicationId: string; installationId: string; publicKey: Buffer };

export type RegisterOutcome = { kind: "registered" } | { kind: "invalid" };

export type InstallationRecord = { applicationId: string; publicKey: Buffer };

export type SessionOutcome =
  | { kind: "issued"; expiresAt: string }
  | { kind: "inactive" }
  /** The nonce was already used by this installation. */
  | { kind: "replayed" };

export type RegistrationStore = {
  issueChallenge(input: ChallengeInput): Promise<IssueOutcome>;
  /** Records the provider's answer for a mailed code; a refused mail makes the code unusable. */
  recordMail(challengeId: string, result: SendResult): Promise<void>;
  /** A challenge that carries a code (unlocked read; the consuming transaction checks it again). */
  findChallenge(challengeId: string): Promise<ChallengeRecord | null>;
  register(input: { challengeId: string; installationId: string; code: string }): Promise<RegisterOutcome>;
  findInstallation(installationId: string): Promise<InstallationRecord | null>;
  createSession(input: {
    installationId: string;
    applicationId: string;
    nonceDigest: Buffer;
    tokenHash: Buffer;
  }): Promise<SessionOutcome>;
};

/**
 * Every write takes the access request's row lock first and the challenge rows second (the admin's
 * approval change does the same), so issuing, consuming, revoking and session issuing for one email
 * are serialized and cannot deadlock.
 */
export function createRegistrationStore(sql: Database, secret: string): RegistrationStore {
  // Millisecond UTC ISO strings, as everywhere in the API.
  const expiresAtColumn = sql`to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

  return {
    async issueChallenge({ email, installationId, publicKey }) {
      const emailKey = keyedDigest(secret, "email", email.toLowerCase());
      await sql`DELETE FROM update_challenges WHERE expires_at < now() - interval '1 day'`;

      return sql.begin(async (tx) => {
        const [application] = await tx<
          { id: string; email: string; approved: boolean; generation: string }[]
        >`
          SELECT id::text AS id, email, updates_approved AS approved, updates_generation::text AS generation
          FROM access_applications
          WHERE email_normalized = lower(btrim(${email}))
          FOR UPDATE
        `;
        const allowed = application?.approved === true ? application : null;

        // A repeated request within the reissue interval gets the same challenge and no new mail. The
        // same holds for emails that are not allowed, so repeats don't tell them apart.
        const [recent] = await tx<{ id: string; expiresAt: string }[]>`
          SELECT id::text AS id, ${expiresAtColumn} AS "expiresAt"
          FROM update_challenges
          WHERE email_key = ${emailKey}
            AND installation_id = ${installationId}::uuid
            AND public_key = ${publicKey}
            AND state = 'pending'
            AND expires_at > now()
            AND created_at > now() - make_interval(secs => ${CODE_REISSUE_SECONDS})
            AND ${allowed
              ? tx`application_id = ${allowed.id}::bigint AND generation = ${allowed.generation}::bigint`
              : tx`application_id IS NULL`}
          ORDER BY created_at DESC
          LIMIT 1
        `;
        if (recent) return { challengeId: recent.id, expiresAt: recent.expiresAt, delivery: null };

        const [counts] = await tx<{ byEmail: number; byInstallation: number }[]>`
          SELECT
            count(*) FILTER (WHERE email_key = ${emailKey})::int AS "byEmail",
            count(*) FILTER (WHERE installation_id = ${installationId}::uuid)::int AS "byInstallation"
          FROM update_challenges
          WHERE created_at > now() - interval '1 hour'
            AND (email_key = ${emailKey} OR installation_id = ${installationId}::uuid)
        `;
        if (
          counts.byEmail >= CHALLENGES_PER_EMAIL_PER_HOUR ||
          counts.byInstallation >= CHALLENGES_PER_INSTALLATION_PER_HOUR
        ) {
          // Same answer shape as a real challenge; nothing is stored or sent.
          const [{ expiresAt }] = await tx<{ expiresAt: string }[]>`
            SELECT to_char(
              (now() + make_interval(secs => ${CODE_TTL_SECONDS})) AT TIME ZONE 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
            ) AS "expiresAt"
          `;
          return { challengeId: randomUUID(), expiresAt, delivery: null };
        }

        const challengeId = randomUUID();
        if (!allowed) {
          const [row] = await tx<{ expiresAt: string }[]>`
            INSERT INTO update_challenges (id, email_key, installation_id, public_key, mail_status, expires_at)
            VALUES (${challengeId}::uuid, ${emailKey}, ${installationId}::uuid, ${publicKey}, 'none',
                    now() + make_interval(secs => ${CODE_TTL_SECONDS}))
            RETURNING ${expiresAtColumn} AS "expiresAt"
          `;
          return { challengeId, expiresAt: row.expiresAt, delivery: null };
        }

        // A new code replaces this installation's earlier unused codes. Other installations' codes and
        // the currently registered Mac are left alone until a registration actually commits.
        await tx`
          UPDATE update_challenges SET state = 'void'
          WHERE application_id = ${allowed.id}::bigint AND installation_id = ${installationId}::uuid AND state = 'pending'
        `;
        const code = generateCode();
        const [row] = await tx<{ expiresAt: string }[]>`
          INSERT INTO update_challenges (
            id, email_key, installation_id, public_key, application_id, generation, code_hmac, mail_status, expires_at
          )
          VALUES (
            ${challengeId}::uuid, ${emailKey}, ${installationId}::uuid, ${publicKey}, ${allowed.id}::bigint,
            ${allowed.generation}::bigint, ${keyedDigest(secret, "code", challengeId, code)}, 'pending',
            now() + make_interval(secs => ${CODE_TTL_SECONDS})
          )
          RETURNING ${expiresAtColumn} AS "expiresAt"
        `;
        return { challengeId, expiresAt: row.expiresAt, delivery: { to: allowed.email, code } };
      });
    },

    async recordMail(challengeId, result) {
      const code = result.outcome === "accepted" ? null : result.code.slice(0, 100);
      await sql`
        UPDATE update_challenges SET
          mail_status = ${result.outcome},
          mail_error_code = ${code},
          state = CASE WHEN ${result.outcome} = 'rejected' AND state = 'pending' THEN 'void' ELSE state END
        WHERE id = ${challengeId}::uuid AND mail_status = 'pending'
      `;
    },

    async findChallenge(challengeId) {
      const [row] = await sql<{ applicationId: string; installationId: string; publicKey: Buffer }[]>`
        SELECT application_id::text AS "applicationId", installation_id::text AS "installationId",
               public_key AS "publicKey"
        FROM update_challenges
        WHERE id = ${challengeId}::uuid AND application_id IS NOT NULL
      `;
      return row ?? null;
    },

    async register({ challengeId, installationId, code }) {
      const invalid = { kind: "invalid" } as const;
      return sql.begin(async (tx): Promise<RegisterOutcome> => {
        const [owner] = await tx<{ applicationId: string }[]>`
          SELECT application_id::text AS "applicationId" FROM update_challenges
          WHERE id = ${challengeId}::uuid AND application_id IS NOT NULL
        `;
        if (!owner) return invalid;

        // Locks: the request row, then the challenge row. Everything below reads the locked state.
        const [application] = await tx<{ approved: boolean; generation: string }[]>`
          SELECT updates_approved AS approved, updates_generation::text AS generation
          FROM access_applications WHERE id = ${owner.applicationId}::bigint
          FOR UPDATE
        `;
        const [challenge] = await tx<
          {
            installationId: string;
            publicKey: Buffer;
            applicationId: string | null;
            generation: string | null;
            codeHmac: string | null;
            state: string;
            mailStatus: string;
            live: boolean;
          }[]
        >`
          SELECT installation_id::text AS "installationId", public_key AS "publicKey",
                 application_id::text AS "applicationId", generation::text AS generation,
                 code_hmac AS "codeHmac", state, mail_status AS "mailStatus", expires_at > now() AS live
          FROM update_challenges WHERE id = ${challengeId}::uuid
          FOR UPDATE
        `;
        if (
          !application?.approved ||
          !challenge ||
          challenge.applicationId !== owner.applicationId ||
          challenge.generation !== application.generation ||
          challenge.installationId !== installationId ||
          challenge.state !== "pending" ||
          challenge.mailStatus === "rejected" ||
          !challenge.live ||
          !challenge.codeHmac
        ) {
          return invalid;
        }

        if (!sameHex(keyedDigest(secret, "code", challengeId, code), challenge.codeHmac)) {
          await tx`
            UPDATE update_challenges SET
              failed_attempts = failed_attempts + 1,
              state = CASE WHEN failed_attempts + 1 >= ${CODE_MAX_FAILED_ATTEMPTS} THEN 'void' ELSE state END
            WHERE id = ${challengeId}::uuid
          `;
          return invalid;
        }

        // An installation id keeps its first key and request; one key belongs to one installation.
        const bound = await tx<{ applicationId: string; installationId: string; sameKey: boolean }[]>`
          SELECT application_id::text AS "applicationId", installation_id::text AS "installationId",
                 public_key = ${challenge.publicKey} AS "sameKey"
          FROM update_installations
          WHERE installation_id = ${installationId}::uuid OR public_key = ${challenge.publicKey}
          FOR NO KEY UPDATE
        `;
        const conflicting = bound.some(
          (row) =>
            row.installationId !== installationId || row.applicationId !== owner.applicationId || !row.sameKey,
        );
        if (conflicting) {
          await tx`UPDATE update_challenges SET state = 'void' WHERE id = ${challengeId}::uuid`;
          return invalid;
        }
        if (bound.length === 0) {
          await tx`
            INSERT INTO update_installations (installation_id, application_id, public_key)
            VALUES (${installationId}::uuid, ${owner.applicationId}::bigint, ${challenge.publicKey})
          `;
        } else {
          await tx`UPDATE update_installations SET registered_at = now() WHERE installation_id = ${installationId}::uuid`;
        }

        // One commit: the code is used, every other unused code of this request is void and this
        // installation becomes the only active one. The new generation ends every earlier session (they
        // then answer 403, not 401, so the previous Mac learns it was replaced).
        await tx`UPDATE update_challenges SET state = 'used', used_at = now() WHERE id = ${challengeId}::uuid`;
        await tx`
          UPDATE update_challenges SET state = 'void'
          WHERE application_id = ${owner.applicationId}::bigint AND state = 'pending'
        `;
        await tx`
          UPDATE access_applications SET
            updates_generation = updates_generation + 1,
            active_installation_id = ${installationId}::uuid
          WHERE id = ${owner.applicationId}::bigint
        `;
        return { kind: "registered" };
      });
    },

    async findInstallation(installationId) {
      const [row] = await sql<{ applicationId: string; publicKey: Buffer }[]>`
        SELECT application_id::text AS "applicationId", public_key AS "publicKey"
        FROM update_installations WHERE installation_id = ${installationId}::uuid
      `;
      return row ?? null;
    },

    async createSession({ installationId, applicationId, nonceDigest, tokenHash }) {
      await sql`DELETE FROM update_session_nonces WHERE created_at < now() - interval '15 minutes'`;
      await sql`DELETE FROM update_sessions WHERE expires_at < now() - interval '1 day'`;

      return sql.begin(async (tx): Promise<SessionOutcome> => {
        const [application] = await tx<{ active: boolean; generation: string }[]>`
          SELECT coalesce(updates_approved AND active_installation_id = ${installationId}::uuid, false) AS active,
                 updates_generation::text AS generation
          FROM access_applications WHERE id = ${applicationId}::bigint
          FOR SHARE
        `;
        if (!application?.active) return { kind: "inactive" };

        // The proof was verified with this installation's key before this point, so a forged request
        // can never use up a nonce.
        const fresh = await tx`
          INSERT INTO update_session_nonces (installation_id, nonce_digest)
          VALUES (${installationId}::uuid, ${nonceDigest})
          ON CONFLICT DO NOTHING
          RETURNING 1
        `;
        if (fresh.length === 0) return { kind: "replayed" };

        const [session] = await tx<{ expiresAt: string }[]>`
          INSERT INTO update_sessions (token_hash, installation_id, application_id, generation, expires_at)
          VALUES (${tokenHash}, ${installationId}::uuid, ${applicationId}::bigint, ${application.generation}::bigint,
                  now() + make_interval(secs => ${SESSION_TTL_SECONDS}))
          RETURNING ${expiresAtColumn} AS "expiresAt"
        `;
        return { kind: "issued", expiresAt: session.expiresAt };
      });
    },
  };
}

function sameHex(a: string, b: string) {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}
