import "server-only";
import { getDatabase } from "@/lib/applications/db";
import { composeApprovalMail } from "@/lib/notifications/approval-mail";
import { createGmailSender, type MailSender } from "@/lib/notifications/mailer";
import { installLinkUrl } from "@/lib/update-packages/install-contracts";
import { newAccessToken, sha256 } from "@/lib/updates/registration/crypto";
import { createApprovalMailStore, type ApprovalMailStore, type MailClaim } from "./approval-mail-store";
import { getAuth } from "./better-auth";
import { INSTALL_LINK_TTL_HOURS } from "./contracts";

// The approval mail (one mail with a new private install link, see approval-mail-store.ts), sent after the
// approval is committed. One attempt asks the mail service at most once, and only after recording that it
// does: Gmail has no idempotency key, so a mail whose answer is lost is shown as uncertain and only the
// operator sends it again. The link's token lives in this attempt's memory and in the mail only. Logs carry
// short codes, never addresses, names, links or provider messages.

export type ApprovalMailServices = {
  store: ApprovalMailStore;
  /** Null when mail is not configured: the attempt is recorded as failed (`mail_not_configured`). */
  sender: MailSender | null;
  /** The site the link opens on (this deployment's BETTER_AUTH_URL); null when unset. */
  origin: string | null;
  /** The link's secret: 32 random bytes, base64url. */
  newToken?: () => string;
};

const LOG_PREFIX = "[approval-mail]";
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;

/** Gmail requests per attempt are bounded: one token request and one send, each at most this long. */
export const APPROVAL_MAIL_REQUEST_TIMEOUT_MS = 8000;

/**
 * The deployment's approval mail: the database, the Gmail sender (GMAIL_* with the registration code mail's
 * sender, UPDATE_CODE_MAIL_FROM) and the admin origin (BETTER_AUTH_URL) the link opens on. Null without a
 * database; without mail or origin the sender or origin is null and an attempt records mail_not_configured.
 * No token retries and short timeouts: the operator waits for a save, and the recovery run budgets its time
 * by the longest attempt.
 */
export function getConfiguredApprovalMailServices(): ApprovalMailServices | null {
  const sql = getDatabase();
  if (!sql) return null;
  const clientId = readEnv("GMAIL_CLIENT_ID");
  const clientSecret = readEnv("GMAIL_CLIENT_SECRET");
  const refreshToken = readEnv("GMAIL_REFRESH_TOKEN");
  const from = readEnv("UPDATE_CODE_MAIL_FROM");
  const sender =
    clientId && clientSecret && refreshToken && from
      ? createGmailSender({
          clientId,
          clientSecret,
          refreshToken,
          from,
          tokenRetryDelaysMs: [],
          timeoutMs: APPROVAL_MAIL_REQUEST_TIMEOUT_MS,
        })
      : null;
  return { store: createApprovalMailStore(sql), sender, origin: getAuth()?.config.baseURL ?? null };
}

/** Sends the stored mail `id` unless someone claimed it first. */
export async function sendApprovalMail(id: string, services: ApprovalMailServices): Promise<void> {
  let claim: MailClaim | null;
  try {
    claim = await services.store.claim(id);
  } catch (error) {
    // Left queued: the recovery run or the operator sends it.
    console.error(LOG_PREFIX, "mail was not claimed", describeError(error));
    return;
  }
  if (claim) await runApprovalMail(claim, services);
}

export type LeftBehindBudget = {
  /** No attempt starts unless it can end before this (epoch ms). */
  deadline: number;
  /** The longest one attempt takes: two bounded provider requests and a few statements. */
  attemptMs: number;
  /**
   * The longest the send and its record take. Once the rows are held, an attempt asks the mail service only if
   * this still fits before `deadline`; else it hands the mail back unsent for the next call.
   */
  sendMs: number;
  /** At most this many attempts per call. */
  limit: number;
  now?: () => number;
};

/**
 * Sends the mails left behind (never claimed, or stopped before the mail service was asked), one claim at a
 * time while an attempt still fits before `deadline`: a mail is claimed only when it can be sent in this call,
 * so the ones left over stay claimable by the next call at once, and no attempt is cut off after it recorded
 * its start.
 */
export async function sendLeftBehindApprovalMails(
  services: ApprovalMailServices,
  { deadline = Infinity, attemptMs = 0, sendMs = 0, limit = 20, now = Date.now }: Partial<LeftBehindBudget> = {},
): Promise<number> {
  const inTime = () => now() + sendMs <= deadline;
  let attempted = 0;
  while (attempted < limit && now() + attemptMs <= deadline) {
    const [claim] = await services.store.claimLeftBehind(1);
    if (!claim) break;
    await runApprovalMail(claim, services, { inTime });
    attempted += 1;
  }
  return attempted;
}

/**
 * One attempt for a claimed mail. Never throws; everything it learns is recorded on the mail. `inTime` (the
 * recovery run's): asked once the rows are held, right before the start is recorded; false hands it back unsent.
 */
export async function runApprovalMail(
  claim: MailClaim,
  services: ApprovalMailServices,
  { inTime }: { inTime?: () => boolean } = {},
): Promise<void> {
  const { store, sender, origin } = services;
  const fail = async (code: string) => {
    try {
      await store.fail(claim, code);
    } catch (error) {
      // Stays claimed and is taken as interrupted later: nothing was sent.
      console.error(LOG_PREFIX, "failure was not recorded", describeError(error));
    }
  };

  try {
    if (!sender || !origin) {
      console.error(LOG_PREFIX, "mail is not configured");
      await fail("mail_not_configured");
      return;
    }
    // Before any link exists: a mail that can not go out leaves the request's open link as it is.
    const access = await sender.authorize();
    if (!access.ok) {
      console.error(LOG_PREFIX, "mail access failed", { code: access.code });
      await fail(access.code);
      return;
    }

    const token = (services.newToken ?? newAccessToken)();
    const prepared = await store.prepare(claim, {
      tokenHash: sha256(token),
      ttlSeconds: INSTALL_LINK_TTL_HOURS * 60 * 60,
    });
    if (prepared.kind === "failed") console.warn(LOG_PREFIX, "mail not sent", { code: prepared.code });
    if (prepared.kind !== "ready") return;

    // Committed before the one request: from here on the mail may go out, so it is never repeated by itself.
    if (!(await store.markSending(claim, { inTime }))) return;
    const mail = composeApprovalMail({
      name: prepared.name,
      url: installLinkUrl(origin, token),
      expiresAt: prepared.link.expiresAt,
      version: prepared.link.version,
    });
    const result = await access.send(prepared.to, mail);
    if (result.outcome !== "accepted") console.warn(LOG_PREFIX, "mail not accepted", { code: result.code });
    try {
      await store.finish(claim, result);
    } catch (error) {
      // Shown as uncertain once it is stale; the operator decides whether to send it again.
      console.error(LOG_PREFIX, "mail result was not recorded", describeError(error));
    }
  } catch (error) {
    console.error(LOG_PREFIX, "attempt stopped", describeError(error));
    // Only an attempt that never asked the mail service can be marked failed.
    await fail("internal_error");
  }
}

function readEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value && !CONTROL_CHARACTERS.test(value) ? value : null;
}

/** Error class and code only: messages can contain addresses or names. */
function describeError(error: unknown) {
  if (!(error instanceof Error)) return { name: typeof error };
  const code = (error as { code?: unknown }).code;
  return { name: error.name, code: typeof code === "string" ? code : undefined };
}
