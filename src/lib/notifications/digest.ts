import "server-only";
import { ADMIN_INBOX_PATH } from "@/lib/admin/contracts";
import { SITE_URL } from "@/lib/links";
import type { DigestStore } from "./digest-store";
import type { DigestMail, DigestMailer } from "./mailer";

export type DigestServices = { store: DigestStore; mailer: DigestMailer };

export type DigestRunResult =
  /** `mayRepeat`: an earlier uncertain send of this batch may also have arrived (two mails). */
  | { ok: true; status: "sent"; count: number; mayRepeat: boolean }
  | { ok: true; status: "skipped" | "busy"; count: 0 }
  /** Nothing was confirmed as sent; the batch stays unfinished and the next day's call retries it. */
  | { ok: false; reason: "failed" | "unknown"; code: string };

export const ADMIN_INBOX_URL = new URL(ADMIN_INBOX_PATH, SITE_URL).href;

/** The only inputs are the count and fixed links, so no applicant data can reach the mail. */
export function composeDigestMail(count: number): DigestMail {
  return {
    subject: `Nokka 새 사용 신청 ${count}건`,
    text: [
      `Nokka에 새 사용 신청 ${count}건이 접수되었습니다.`,
      "",
      `신청함 보기(로그인 필요): ${ADMIN_INBOX_URL}`,
      "",
      "새 신청이 있는 날 하루 한 번 보내는 관리자 알림입니다.",
    ].join("\n"),
  };
}

/**
 * One cron call: claim a batch in a short transaction, get mail access, record the day's single send
 * attempt, send once outside any transaction, then record the outcome. A batch is recorded as sent
 * only after the provider returned a message id. An unsent or uncertain batch waits for the next
 * day's call (Gmail has no idempotency key, so an uncertain send is never repeated within a call).
 */
export async function runApplicationDigest({ store, mailer }: DigestServices): Promise<DigestRunResult> {
  const claim = await store.claim();
  if (claim.kind === "busy") return { ok: true, status: "busy", count: 0 };
  if (claim.kind === "skipped") return { ok: true, status: "skipped", count: 0 };

  const { batch } = claim;
  // Keeps "unknown" once an earlier send may have arrived, so the repeat stays visible.
  const notSent = async (code: string): Promise<DigestRunResult> => {
    if (batch.mayRepeat) {
      await store.markUnknown(batch, code);
      return { ok: false, reason: "unknown", code };
    }
    await store.markFailed(batch, code);
    return { ok: false, reason: "failed", code };
  };

  const access = await mailer.authorize();
  if (!access.ok) return notSent(access.code);
  // The lease was taken over (practically impossible within the route's time limit): send nothing.
  if (!(await store.markSendAttempt(batch))) return { ok: true, status: "busy", count: 0 };

  const result = await access.send(composeDigestMail(batch.count));
  if (result.outcome === "accepted") {
    if (await store.markSent(batch, result.messageId)) {
      return { ok: true, status: "sent", count: batch.count, mayRepeat: batch.mayRepeat };
    }
    return { ok: false, reason: "unknown", code: "lease_lost" };
  }
  if (result.outcome === "rejected") return notSent(result.code);
  await store.markUnknown(batch, result.code);
  return { ok: false, reason: "unknown", code: result.code };
}
