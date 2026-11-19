import "server-only";

/** Subject and plain text only: the digest never carries names, emails or notes. */
export type DigestMail = { subject: string; text: string };

export type SendResult =
  /** The provider returned a message id (this is not proof that it reached the inbox). */
  | { outcome: "accepted"; messageId: string }
  /** The provider refused it, so nothing was sent. */
  | { outcome: "rejected"; code: string }
  /** It may or may not have been sent. Gmail has no idempotency key, so a resend may repeat it. */
  | { outcome: "uncertain"; code: string };

export type MailAuthorization =
  /** `send` makes exactly one provider request. */
  | { ok: true; send(mail: DigestMail): Promise<SendResult> }
  /** No access (for example a revoked refresh token); nothing was sent. */
  | { ok: false; code: string };

export type DigestMailer = {
  /** Gets permission to send (it never sends). Never throws: failures come back as `{ ok: false }`. */
  authorize(): Promise<MailAuthorization>;
};

export type GmailMailerOptions = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** The connected Gmail address. */
  from: string;
  to: string;
  fetch?: typeof fetch;
  /** Waits before each extra token request after a transient error; sends are never retried here. */
  tokenRetryDelaysMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
};

export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const MESSAGE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const ERROR_NAME = /^[A-Za-z_]{1,64}$/;

/**
 * Gmail API users.messages.send with an offline refresh token (scope gmail.send; this code never
 * reads mail). The access token is fetched per call and kept in memory only.
 */
export function createGmailMailer({
  clientId,
  clientSecret,
  refreshToken,
  from,
  to,
  fetch: fetchImpl = fetch,
  tokenRetryDelaysMs = [1000, 3000],
  sleep = defaultSleep,
  timeoutMs = 10_000,
}: GmailMailerOptions): DigestMailer {
  async function requestToken(): Promise<{ token: string } | { code: string; transient: boolean }> {
    let response: Response;
    let body: unknown;
    try {
      response = await fetchImpl(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
          grant_type: "refresh_token",
        }),
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
      });
      body = await response.json().catch(() => null);
    } catch (error) {
      return { code: isTimeout(error) ? "gmail_token_timeout" : "gmail_token_network", transient: true };
    }

    const fields = (body ?? {}) as { access_token?: unknown; scope?: unknown; error?: unknown };
    if (response.ok) {
      if (typeof fields.access_token !== "string" || !fields.access_token) {
        return { code: "gmail_token_invalid_response", transient: true };
      }
      if (typeof fields.scope === "string" && !fields.scope.split(" ").includes(GMAIL_SEND_SCOPE)) {
        return { code: "gmail_token_scope_missing", transient: false };
      }
      return { token: fields.access_token };
    }
    // invalid_grant: the refresh token was revoked or expired and needs consent again.
    const code = `gmail_token_${response.status}${errorSuffix(fields.error)}`;
    return { code, transient: response.status >= 500 || response.status === 429 };
  }

  async function send(token: string, mail: DigestMail): Promise<SendResult> {
    let response: Response;
    let body: unknown;
    try {
      response = await fetchImpl(GMAIL_SEND_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ raw: Buffer.from(buildMessage(from, to, mail)).toString("base64url") }),
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
      });
      body = await response.json().catch(() => null);
    } catch (error) {
      // The request may have reached Gmail before the connection failed or timed out.
      return { outcome: "uncertain", code: isTimeout(error) ? "gmail_send_timeout" : "gmail_send_network" };
    }

    if (response.ok) {
      const id = (body as { id?: unknown } | null)?.id;
      if (typeof id === "string" && MESSAGE_ID.test(id)) return { outcome: "accepted", messageId: id };
      return { outcome: "uncertain", code: "gmail_send_invalid_response" };
    }
    const error = (body as { error?: { status?: unknown; errors?: { reason?: unknown }[] } } | null)?.error;
    const code = `gmail_send_${response.status}${errorSuffix(error?.errors?.[0]?.reason ?? error?.status)}`;
    // Gmail backend errors may still have sent it; 4xx (bad request, credentials, limits) did not.
    if (response.status >= 500) return { outcome: "uncertain", code };
    return { outcome: "rejected", code };
  }

  return {
    async authorize() {
      let result = await requestToken();
      for (const delay of tokenRetryDelaysMs) {
        if ("token" in result || !result.transient) break;
        await sleep(delay);
        result = await requestToken();
      }
      if (!("token" in result)) return { ok: false, code: result.code };
      const { token } = result;
      return { ok: true, send: (mail) => send(token, mail) };
    },
  };
}

/** RFC 2822 plain-text message with a UTF-8 subject (RFC 2047) and base64 body, CRLF line ends. */
export function buildMessage(from: string, to: string, { subject, text }: DigestMail): string {
  const body = Buffer.from(text, "utf8").toString("base64").replace(/.{76}/g, "$&\r\n");
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    body,
  ].join("\r\n");
}

/** Provider error names only (never messages, which can contain addresses). */
function errorSuffix(name: unknown) {
  return typeof name === "string" && ERROR_NAME.test(name) ? `_${name}` : "";
}

function isTimeout(error: unknown) {
  return error instanceof Error && error.name === "TimeoutError";
}

function defaultSleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
