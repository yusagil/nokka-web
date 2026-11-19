// @vitest-environment node
import { beforeEach, describe, it, expect, vi } from "vitest";

const ADMIN_ID = "212495406";
const auth = vi.hoisted(() => ({
  configured: true,
  getSession: vi.fn(),
  findAccounts: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ cookie: "better-auth.session_token=x" }) }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
}));
vi.mock("../better-auth", () => ({
  getAuth: () =>
    auth.configured
      ? {
          config: { adminGithubUserId: ADMIN_ID },
          auth: {
            api: { getSession: auth.getSession },
            $context: Promise.resolve({ internalAdapter: { findAccounts: auth.findAccounts } }),
          },
        }
      : null,
}));

const { getAdminSession, requireAdminPage } = await import("../session");

beforeEach(() => {
  auth.configured = true;
  auth.getSession.mockReset().mockResolvedValue({ user: { id: "user-1" }, session: { id: "s" } });
  auth.findAccounts.mockReset().mockResolvedValue([{ providerId: "github", accountId: ADMIN_ID }]);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("getAdminSession", () => {
  it("accepts a valid session linked to the admin's GitHub id", async () => {
    const requestHeaders = new Headers({ cookie: "c" });
    expect(await getAdminSession(requestHeaders)).toEqual({ ok: true, admin: { githubUserId: ADMIN_ID } });
    expect(auth.getSession).toHaveBeenCalledWith({ headers: requestHeaders });
    expect(auth.findAccounts).toHaveBeenCalledWith("user-1");
  });

  it("answers 503 when auth is not configured", async () => {
    auth.configured = false;
    expect(await getAdminSession(new Headers())).toEqual({ ok: false, status: 503, code: "UNAVAILABLE" });
  });

  it("answers 401 without a valid session", async () => {
    auth.getSession.mockResolvedValue(null);
    expect(await getAdminSession(new Headers())).toEqual({ ok: false, status: 401, code: "UNAUTHENTICATED" });
  });

  it.each([
    ["another GitHub id", [{ providerId: "github", accountId: "1" }]],
    ["another provider with the same id", [{ providerId: "google", accountId: ADMIN_ID }]],
    ["no linked account", []],
  ])("answers 403 for %s", async (_, accounts) => {
    auth.findAccounts.mockResolvedValue(accounts);
    expect(await getAdminSession(new Headers())).toEqual({ ok: false, status: 403, code: "FORBIDDEN" });
  });

  it("answers 503 when the session lookup fails", async () => {
    auth.getSession.mockRejectedValue(Object.assign(new Error("db down"), { code: "ECONNREFUSED" }));
    expect(await getAdminSession(new Headers())).toEqual({ ok: false, status: 503, code: "UNAVAILABLE" });
  });
});

describe("requireAdminPage", () => {
  it("returns the admin", async () => {
    expect(await requireAdminPage()).toEqual({ githubUserId: ADMIN_ID });
  });

  it.each([
    ["no session", () => auth.getSession.mockResolvedValue(null), "/admin/login"],
    ["another account", () => auth.findAccounts.mockResolvedValue([]), "/admin/login?error=forbidden"],
    ["missing configuration", () => (auth.configured = false), "/admin/login?error=unavailable"],
  ])("redirects with %s", async (_, arrange, target) => {
    arrange();
    await expect(requireAdminPage()).rejects.toThrow(`REDIRECT ${target}`);
  });
});
