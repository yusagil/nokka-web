import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "./better-auth";
import { ADMIN_LOGIN_PATH } from "./contracts";

export type AdminIdentity = { githubUserId: string };

export type AdminSessionResult =
  | { ok: true; admin: AdminIdentity }
  | { ok: false; status: 401; code: "UNAUTHENTICATED" }
  | { ok: false; status: 403; code: "FORBIDDEN" }
  | { ok: false; status: 503; code: "UNAVAILABLE" };

const UNAUTHENTICATED = { ok: false, status: 401, code: "UNAUTHENTICATED" } as const;
const FORBIDDEN = { ok: false, status: 403, code: "FORBIDDEN" } as const;
const UNAVAILABLE = { ok: false, status: 503, code: "UNAVAILABLE" } as const;

/**
 * Validates the session cookie against the database and checks that the session's user is linked to
 * the configured GitHub id. A cookie alone, a valid session of another account, or missing
 * configuration never pass.
 */
export async function getAdminSession(requestHeaders: Headers): Promise<AdminSessionResult> {
  const configured = getAuth();
  if (!configured) return UNAVAILABLE;
  const { auth, config } = configured;

  try {
    const session = await auth.api.getSession({ headers: requestHeaders });
    if (!session) return UNAUTHENTICATED;

    const context = await auth.$context;
    const accounts = await context.internalAdapter.findAccounts(session.user.id);
    const isAdmin = accounts.some(
      (account) => account.providerId === "github" && account.accountId === config.adminGithubUserId,
    );
    return isAdmin ? { ok: true, admin: { githubUserId: config.adminGithubUserId } } : FORBIDDEN;
  } catch (error) {
    console.error("[admin] session check failed", describeError(error));
    return UNAVAILABLE;
  }
}

/** For server layouts: the admin, or a redirect to the login page with the reason. */
export async function requireAdminPage(): Promise<AdminIdentity> {
  const result = await getAdminSession(await headers());
  if (result.ok) return result.admin;
  if (result.status === 401) redirect(ADMIN_LOGIN_PATH);
  redirect(`${ADMIN_LOGIN_PATH}?error=${result.status === 403 ? "forbidden" : "unavailable"}`);
}

function describeError(error: unknown) {
  if (!(error instanceof Error)) return { name: typeof error };
  const code = (error as { code?: unknown }).code;
  return { name: error.name, code: typeof code === "string" ? code : undefined };
}
