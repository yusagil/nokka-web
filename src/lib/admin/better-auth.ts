import "server-only";
import { betterAuth } from "better-auth";
import { github } from "better-auth/social-providers";
import { Pool } from "pg";
import { ADMIN_LOGIN_PATH } from "./contracts";

export type AuthConfig = {
  secret: string;
  baseURL: string;
  githubClientId: string;
  githubClientSecret: string;
  /** GitHub's numeric, immutable user id of the one admin (not the login name). */
  adminGithubUserId: string;
  databaseUrl: string;
};

/** Null unless every setting is present and well-formed; callers then answer 503 (fail closed). */
export function readAuthConfig(
  env: Record<string, string | undefined> = process.env,
): AuthConfig | null {
  const config = {
    secret: env.BETTER_AUTH_SECRET ?? "",
    baseURL: env.BETTER_AUTH_URL ?? "",
    githubClientId: env.GITHUB_CLIENT_ID ?? "",
    githubClientSecret: env.GITHUB_CLIENT_SECRET ?? "",
    adminGithubUserId: env.ADMIN_GITHUB_USER_ID ?? "",
    databaseUrl: env.DATABASE_URL ?? "",
  };
  if (config.secret.length < 32) return null;
  if (!/^[1-9]\d*$/.test(config.adminGithubUserId)) return null;
  if (!config.githubClientId || !config.githubClientSecret || !config.databaseUrl) return null;
  try {
    const url = new URL(config.baseURL);
    if (url.origin !== config.baseURL.replace(/\/$/, "")) return null;
    config.baseURL = url.origin;
  } catch {
    return null;
  }
  return config;
}

export function createAuth(config: AuthConfig, database: Pool) {
  const githubProvider = github({
    clientId: config.githubClientId,
    clientSecret: config.githubClientSecret,
  });

  return betterAuth({
    appName: "Nokka",
    baseURL: config.baseURL,
    secret: config.secret,
    database,
    telemetry: { enabled: false },
    emailAndPassword: { enabled: false },
    user: { modelName: "auth_user" },
    session: { modelName: "auth_session" },
    account: {
      modelName: "auth_account",
      accountLinking: { enabled: false },
      encryptOAuthTokens: true,
    },
    verification: { modelName: "auth_verification" },
    socialProviders: {
      github: {
        clientId: config.githubClientId,
        clientSecret: config.githubClientSecret,
        // Any other GitHub account stops here, before a user row with its profile is written.
        async getUserInfo(token) {
          const info = await githubProvider.getUserInfo(token);
          if (!info || String((info.data as { id?: unknown }).id) !== config.adminGithubUserId) {
            return null;
          }
          return info;
        },
      },
    },
    databaseHooks: {
      session: {
        create: {
          // Second gate: a session is only issued to the user linked to the admin's GitHub id.
          async before(session, ctx) {
            if (!ctx) return false;
            const accounts = await ctx.context.internalAdapter.findAccounts(session.userId);
            const isAdmin = accounts.some(
              (account) =>
                account.providerId === "github" && account.accountId === config.adminGithubUserId,
            );
            return isAdmin ? undefined : false;
          },
        },
      },
    },
    onAPIError: { errorURL: `${config.baseURL}${ADMIN_LOGIN_PATH}` },
  });
}

export type Auth = ReturnType<typeof createAuth>;

let cached: { auth: Auth; config: AuthConfig } | undefined;

/** The configured Better Auth instance, or null while any auth setting is missing. */
export function getAuth(): { auth: Auth; config: AuthConfig } | null {
  if (cached) return cached;
  const config = readAuthConfig();
  if (!config) return null;
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: 3,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 20000,
  });
  cached = { auth: createAuth(config, pool), config };
  return cached;
}
