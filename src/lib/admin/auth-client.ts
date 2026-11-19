// Client-side auth actions for the admin pages. Same-origin Better Auth endpoints (/api/auth/*).
import { ADMIN_INBOX_PATH, ADMIN_LOGIN_PATH } from "./contracts";

// Loaded on first use: rendering the admin pages (also on the server) never needs the auth client.
let client: Promise<ReturnType<typeof import("better-auth/client").createAuthClient>> | undefined;

function authClient() {
  client ??= import("better-auth/client").then(({ createAuthClient }) => createAuthClient());
  return client;
}

/** Starts GitHub sign-in. Resolves only on failure (success navigates away); throws then. */
export async function signInWithGitHub(): Promise<void> {
  const { error } = await (await authClient()).signIn.social({
    provider: "github",
    callbackURL: ADMIN_INBOX_PATH,
    errorCallbackURL: ADMIN_LOGIN_PATH,
  });
  if (error) throw new Error("GitHub sign-in could not start");
}

/** Ends the admin session and goes to the login page. Throws if the session could not be ended. */
export async function signOutAdmin(): Promise<void> {
  const { error } = await (await authClient()).signOut();
  if (error) throw new Error("Sign-out failed");
  window.location.assign(ADMIN_LOGIN_PATH);
}
