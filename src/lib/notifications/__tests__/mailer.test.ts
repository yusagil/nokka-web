// @vitest-environment node
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import {
  buildMessage,
  createGmailMailer,
  GMAIL_SEND_SCOPE,
  GMAIL_SEND_URL,
  GOOGLE_TOKEN_URL,
  type GmailMailerOptions,
} from "../mailer";

vi.mock("server-only", () => ({}));

const MAIL = { subject: "Nokka 새 사용 신청 2건", text: "Nokka에 새 사용 신청 2건이 접수되었습니다." };
const OPTIONS = {
  clientId: "client-id.apps.googleusercontent.com",
  clientSecret: "client-secret",
  refreshToken: "refresh-token",
  from: "owner@gmail.com",
  to: "owner@gmail.com",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const token = (scope = `openid ${GMAIL_SEND_SCOPE} https://www.googleapis.com/auth/userinfo.email`) =>
  json(200, { access_token: "ya29.access", expires_in: 3599, scope, token_type: "Bearer" });

/** Answers token requests and send requests from two queues; anything else fails the test. */
function fakeGoogle({
  tokens = [token()],
  sends = [json(200, { id: "18c1f0a2b3c4d5e6" })],
}: { tokens?: Reply[]; sends?: Reply[] } = {}) {
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const queue = url === GOOGLE_TOKEN_URL ? tokens : url === GMAIL_SEND_URL ? sends : null;
    if (!queue) throw new Error(`unexpected request: ${String(url)}`);
    const next = queue.length > 1 ? queue.shift()! : queue[0];
    if (next instanceof Error) throw next;
    if (next === "hang") {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
      });
    }
    return next.clone();
  });
  const calls = (url: string) => fetch.mock.calls.filter(([target]) => target === url);
  return { fetch, calls };
}

type Reply = Response | Error | "hang";
const mailer = (google: ReturnType<typeof fakeGoogle>, options: Partial<GmailMailerOptions> = {}) =>
  createGmailMailer({ ...OPTIONS, fetch: google.fetch, sleep: async () => {}, ...options });
const decodeRaw = (init: RequestInit) =>
  Buffer.from(JSON.parse(init.body as string).raw, "base64url").toString("utf8");

describe("Gmail mailer", () => {
  // Proves the adapter only uses the injected fetch: any real network call fails the test.
  const networkFetch = vi.fn(() => Promise.reject(new Error("real network is disabled in tests")));
  beforeEach(() => vi.stubGlobal("fetch", networkFetch));
  afterEach(() => {
    expect(networkFetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("refreshes the access token, then sends one base64url RFC 2822 message", async () => {
    const google = fakeGoogle();
    const access = await mailer(google).authorize();
    expect(access.ok).toBe(true);
    if (!access.ok) return;
    expect(await access.send(MAIL)).toEqual({ outcome: "accepted", messageId: "18c1f0a2b3c4d5e6" });

    const [[, tokenInit]] = google.calls(GOOGLE_TOKEN_URL) as unknown as [string, RequestInit][];
    expect(tokenInit.method).toBe("POST");
    expect(tokenInit.headers).toEqual({ "Content-Type": "application/x-www-form-urlencoded" });
    expect(Object.fromEntries(tokenInit.body as URLSearchParams)).toEqual({
      client_id: OPTIONS.clientId,
      client_secret: OPTIONS.clientSecret,
      refresh_token: OPTIONS.refreshToken,
      grant_type: "refresh_token",
    });

    const sends = google.calls(GMAIL_SEND_URL) as unknown as [string, RequestInit][];
    expect(sends).toHaveLength(1);
    const [, init] = sends[0];
    expect(init.method).toBe("POST");
    expect(init.cache).toBe("no-store");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.headers).toEqual({ Authorization: "Bearer ya29.access", "Content-Type": "application/json" });
    expect(Object.keys(JSON.parse(init.body as string))).toEqual(["raw"]);
    expect(decodeRaw(init)).toBe(buildMessage(OPTIONS.from, OPTIONS.to, MAIL));
  });

  it("builds a plain-text message with an encoded UTF-8 subject and body", () => {
    const message = buildMessage("owner@gmail.com", "owner@gmail.com", MAIL);
    const [head, body] = message.split("\r\n\r\n");
    expect(head.split("\r\n")).toEqual([
      "From: owner@gmail.com",
      "To: owner@gmail.com",
      `Subject: =?UTF-8?B?${Buffer.from(MAIL.subject).toString("base64")}?=`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
    ]);
    expect(Buffer.from(body.replaceAll("\r\n", ""), "base64").toString("utf8")).toBe(MAIL.text);
    for (const line of body.split("\r\n")) expect(line.length).toBeLessThanOrEqual(76);
  });

  describe("token refresh (never sends)", () => {
    it.each<[string, Reply[]]>([
      ["network errors", [new TypeError("fetch failed"), new TypeError("fetch failed"), token()]],
      ["server errors", [json(503, { error: "temporarily_unavailable" }), json(500, {}), token()]],
      ["a missing access token", [json(200, {}), token()]],
    ])("retries %s within the call", async (_label, tokens) => {
      const google = fakeGoogle({ tokens: [...tokens] });
      const sleep = vi.fn(async () => {});
      const access = await mailer(google, { sleep, tokenRetryDelaysMs: [10, 30] }).authorize();
      expect(access.ok).toBe(true);
      expect(google.calls(GOOGLE_TOKEN_URL)).toHaveLength(tokens.length);
      expect(google.calls(GMAIL_SEND_URL)).toHaveLength(0);
      expect(sleep.mock.calls).toEqual([[10], [30]].slice(0, tokens.length - 1));
    });

    it("stops after three token requests", async () => {
      const google = fakeGoogle({ tokens: [json(503, { error: "temporarily_unavailable" })] });
      expect(await mailer(google).authorize()).toEqual({ ok: false, code: "gmail_token_503_temporarily_unavailable" });
      expect(google.calls(GOOGLE_TOKEN_URL)).toHaveLength(3);
    });

    it("times out a hanging token request", async () => {
      const google = fakeGoogle({ tokens: ["hang"] });
      expect(await mailer(google, { timeoutMs: 20, tokenRetryDelaysMs: [] }).authorize()).toEqual({
        ok: false,
        code: "gmail_token_timeout",
      });
    });

    it.each([
      [400, "invalid_grant"],
      [401, "invalid_client"],
      [400, "unauthorized_client"],
    ])("does not retry a %i %s (revoked or wrong credentials)", async (status, error) => {
      const google = fakeGoogle({
        tokens: [json(status, { error, error_description: "Token has been expired or revoked." })],
      });
      const result = await mailer(google).authorize();
      expect(result).toEqual({ ok: false, code: `gmail_token_${status}_${error}` });
      expect(google.calls(GOOGLE_TOKEN_URL)).toHaveLength(1);
      expect(google.calls(GMAIL_SEND_URL)).toHaveLength(0);
    });

    it("refuses a token without the gmail.send scope", async () => {
      const google = fakeGoogle({ tokens: [token("openid https://www.googleapis.com/auth/userinfo.email")] });
      expect(await mailer(google).authorize()).toEqual({ ok: false, code: "gmail_token_scope_missing" });
      expect(google.calls(GOOGLE_TOKEN_URL)).toHaveLength(1);
    });
  });

  describe("send (one request, never retried)", () => {
    const send = async (reply: Reply, options: Partial<GmailMailerOptions> = {}) => {
      const google = fakeGoogle({ sends: [reply] });
      const access = await mailer(google, options).authorize();
      if (!access.ok) throw new Error("expected access");
      const result = await access.send(MAIL);
      expect(google.calls(GMAIL_SEND_URL)).toHaveLength(1);
      return result;
    };
    const gmailError = (status: number, reason: string) =>
      json(status, {
        error: { code: status, message: "Mail to owner@gmail.com failed", errors: [{ reason }], status: "X" },
      });

    it.each([
      [400, "badRequest"],
      [401, "authError"],
      [403, "dailyLimitExceeded"],
      [403, "userRateLimitExceeded"],
      [429, "rateLimitExceeded"],
    ])("treats %i %s as refused (not sent)", async (status, reason) => {
      const result = await send(gmailError(status, reason));
      expect(result).toEqual({ outcome: "rejected", code: `gmail_send_${status}_${reason}` });
      // Provider messages can contain addresses; only the status and reason are kept.
      expect(JSON.stringify(result)).not.toContain("@");
    });

    it.each([
      ["a 500 backendError", gmailError(500, "backendError"), "gmail_send_500_backendError"],
      ["a 503 without details", new Response("busy", { status: 503 }), "gmail_send_503"],
      ["a network error", new TypeError("fetch failed"), "gmail_send_network"],
      ["a 200 without an id", json(200, { threadId: "x" }), "gmail_send_invalid_response"],
      ["a 200 with an unreadable body", new Response("<html>", { status: 200 }), "gmail_send_invalid_response"],
    ] as [string, Reply, string][])("treats %s as uncertain", async (_label, reply, code) => {
      expect(await send(reply)).toEqual({ outcome: "uncertain", code });
    });

    it("times out a hanging send as uncertain", async () => {
      expect(await send("hang", { timeoutMs: 20 })).toEqual({ outcome: "uncertain", code: "gmail_send_timeout" });
    });

    it("drops error names that are not plain codes", async () => {
      expect(await send(json(403, { error: { errors: [{ reason: "owner@gmail.com" }] } }))).toEqual({
        outcome: "rejected",
        code: "gmail_send_403",
      });
    });
  });
});
