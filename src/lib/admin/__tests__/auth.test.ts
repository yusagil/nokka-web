// @vitest-environment node
import { Pool } from "pg";
import { afterAll, afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { createAuth, readAuthConfig, type AuthConfig } from "../better-auth";

vi.mock("server-only", () => ({}));

const ADMIN_ID = "212495406";
const ENV: Record<string, string | undefined> = {
  BETTER_AUTH_SECRET: "s".repeat(40),
  BETTER_AUTH_URL: "http://localhost:3000",
  GITHUB_CLIENT_ID: "client-id",
  GITHUB_CLIENT_SECRET: "client-secret",
  ADMIN_GITHUB_USER_ID: ADMIN_ID,
  DATABASE_URL: "postgres://nokka@127.0.0.1:1/never-connected",
};

describe("readAuthConfig", () => {
  it("returns the configuration when every setting is valid", () => {
    expect(readAuthConfig({ ...ENV, BETTER_AUTH_URL: "https://nokka-web.vercel.app/" })).toEqual({
      secret: ENV.BETTER_AUTH_SECRET,
      baseURL: "https://nokka-web.vercel.app",
      githubClientId: "client-id",
      githubClientSecret: "client-secret",
      adminGithubUserId: ADMIN_ID,
      databaseUrl: ENV.DATABASE_URL,
    });
  });

  it.each([
    ["no secret", { BETTER_AUTH_SECRET: undefined }],
    ["a short secret", { BETTER_AUTH_SECRET: "s".repeat(31) }],
    ["no base URL", { BETTER_AUTH_URL: undefined }],
    ["a base URL with a path", { BETTER_AUTH_URL: "http://localhost:3000/admin" }],
    ["no client id", { GITHUB_CLIENT_ID: "" }],
    ["no client secret", { GITHUB_CLIENT_SECRET: undefined }],
    ["no admin id", { ADMIN_GITHUB_USER_ID: undefined }],
    ["a login name instead of the numeric id", { ADMIN_GITHUB_USER_ID: "yusagil" }],
    ["no database", { DATABASE_URL: undefined }],
  ])("fails closed with %s", (_, override) => {
    expect(readAuthConfig({ ...ENV, ...override })).toBeNull();
  });
});

describe("Better Auth gates", () => {
  const pool = new Pool({ connectionString: ENV.DATABASE_URL });
  const config = readAuthConfig(ENV) as AuthConfig;
  const auth = createAuth(config, pool);
  const github = auth.options.socialProviders.github;
  const sessionBefore = auth.options.databaseHooks.session.create.before;

  afterAll(() => pool.end());

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function stubGitHub(id: number) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input instanceof Request ? input.url : input);
        if (url.endsWith("/user/emails")) {
          return Response.json([{ email: "qa@example.com", primary: true, verified: true }]);
        }
        return Response.json({ id, login: "qa-user", name: "QA", email: null, avatar_url: null });
      }),
    );
  }

  it("lets only the configured GitHub id past the provider step", async () => {
    stubGitHub(Number(ADMIN_ID));
    const info = await github.getUserInfo!({ accessToken: "token" } as never);
    expect(info?.user.email).toBe("qa@example.com");

    stubGitHub(1);
    expect(await github.getUserInfo!({ accessToken: "token" } as never)).toBeNull();
  });

  it("issues a session only to a user linked to the admin's GitHub account", async () => {
    const ctx = (accounts: { providerId: string; accountId: string }[]) =>
      ({ context: { internalAdapter: { findAccounts: async () => accounts } } }) as never;
    const session = { userId: "user-1" } as never;

    expect(await sessionBefore(session, ctx([{ providerId: "github", accountId: ADMIN_ID }]))).toBeUndefined();
    expect(await sessionBefore(session, ctx([{ providerId: "github", accountId: "1" }]))).toBe(false);
    expect(await sessionBefore(session, ctx([{ providerId: "google", accountId: ADMIN_ID }]))).toBe(false);
    expect(await sessionBefore(session, ctx([]))).toBe(false);
    expect(await sessionBefore(session, null)).toBe(false);
  });

  it("offers GitHub only, without password sign-up", () => {
    expect(Object.keys(auth.options.socialProviders)).toEqual(["github"]);
    expect(auth.options.emailAndPassword.enabled).toBe(false);
    expect(auth.options.account.accountLinking.enabled).toBe(false);
  });
});
