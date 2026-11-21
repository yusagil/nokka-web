// Tests only (never import from application code): synthetic registrations on a disposable database
// that has migration 0005 applied. Goes through the real store, so the rows are what the API writes.
import "server-only";
import { generateKeyPairSync, randomUUID, randomBytes } from "node:crypto";
import type { Database } from "@/lib/applications/db";
import { createAdminApplicationsStore } from "@/lib/admin/applications-store";
import { newAccessToken, sha256 } from "./crypto";
import { createRegistrationStore } from "./store";

const TEST_SECRET = "nokka-updates-test-secret-0123456789abcdef";

export type SeededRegistration = { applicationId: string; installationId: string; accessToken: string };

/** An allowed request for `email` (created if missing) with one registered installation and a live token. */
export async function seedRegisteredSession(sql: Database, { email }: { email: string }): Promise<SeededRegistration> {
  const [application] = await sql<{ id: string }[]>`
    INSERT INTO access_applications (name, email, updates_approved)
    VALUES ('QA updates', ${email}, true)
    ON CONFLICT (email_normalized) DO UPDATE SET updates_approved = true
    RETURNING id::text AS id
  `;
  const store = createRegistrationStore(sql, TEST_SECRET);
  const installationId = randomUUID();
  const { publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" });
  const point = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, "base64url"), Buffer.from(jwk.y!, "base64url")]);

  const issued = await store.issueChallenge({ email, installationId, publicKey: point });
  if (!issued.delivery) throw new Error("no code was issued for the seeded request");
  if ((await store.register({ challengeId: issued.challengeId, installationId, code: issued.delivery.code })).kind !== "registered") {
    throw new Error("seeded registration failed");
  }
  const accessToken = newAccessToken();
  const session = await store.createSession({
    installationId,
    applicationId: application.id,
    nonceDigest: sha256(randomBytes(32)),
    tokenHash: sha256(accessToken),
  });
  if (session.kind !== "issued") throw new Error("seeded session failed");
  return { applicationId: application.id, installationId, accessToken };
}

/** Withdraws the request's update approval the way the admin inbox does. */
export async function revokeUpdatesForTest(sql: Database, applicationId: string): Promise<void> {
  const [row] = await sql<{ updatedAt: string }[]>`
    SELECT to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "updatedAt"
    FROM access_applications WHERE id = ${applicationId}::bigint
  `;
  const outcome = await createAdminApplicationsStore(sql).update(applicationId, {
    updatesApproved: false,
    expectedUpdatedAt: row.updatedAt,
  });
  if (outcome.kind !== "updated") throw new Error(`revoke failed: ${outcome.kind}`);
}
