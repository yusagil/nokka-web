"use client";

import { useId, useRef, useState } from "react";
import { approvalMailIntent, type AdminApplication, type ApprovalMail } from "@/lib/admin/contracts";
import { requestApprovalMail, type ClientFailure } from "./api";
import { APPROVAL_MAIL_STATUS_LABEL, CODE_MAIL_STATUS_LABEL, approvalMailReason, copy } from "./copy";
import { formatDateTime } from "./format";
import type { LinkLock } from "./progress";

interface ApprovalMailPanelProps {
  /** As stored: the panel shows what the server last answered, never a draft. */
  item: AdminApplication;
  /** The request as stored after a send; the card takes its progress fields. */
  onItem: (item: AdminApplication) => void;
  /** Reloads the list; resolves once the fresh items are in. */
  onReload: () => Promise<void>;
  /** The card's one-link-change-at-a-time turn: a mail replaces the request's link. */
  lock?: LinkLock;
}

const BUTTON =
  "inline-flex h-11 items-center justify-center rounded-full border border-line px-6 text-sm font-medium text-fg transition-colors duration-100 hover:bg-surface-2 aria-disabled:cursor-wait aria-disabled:opacity-70";

function errorText(failure: ClientFailure) {
  switch (failure.code) {
    case "CONFLICT":
      return copy.approvalMailConflict;
    case "MAIL_IN_PROGRESS":
      return copy.approvalMailInProgress;
    case "UPDATES_NOT_APPROVED":
      return copy.approvalMailNotApproved;
    case "NOT_FOUND":
      return copy.notFound;
    case "UNAUTHENTICATED":
      return copy.unauthenticated;
    case "FORBIDDEN":
      return copy.forbidden;
    default:
      return copy.approvalMailFailed;
  }
}

type MailBadgeKey = keyof typeof copy.mailBadge;

/** What a closed card shows about an allowed request's approval mail: what, if anything, needs the operator. */
function mailBadgeKey(mail: ApprovalMail | null): MailBadgeKey {
  if (!mail) return "none";
  switch (mail.status) {
    case "queued":
    case "sending":
      return "sending";
    case "uncertain":
      return "uncertain";
    case "accepted":
      return mail.linkState === "expired" || mail.linkState === "downloaded" || mail.linkState === "closed"
        ? mail.linkState
        : "accepted";
    default:
      return "notSent";
  }
}

const BADGE_TONE: Record<MailBadgeKey, string> = {
  none: "bg-accent-soft text-accent-text",
  sending: "bg-surface-2 text-fg-muted",
  accepted: "bg-ok/10 text-ok",
  notSent: "bg-accent-soft text-accent-text",
  uncertain: "bg-[#ff9f0a]/10 text-[#ffb340]",
  expired: "bg-[#ff9f0a]/10 text-[#ffb340]",
  downloaded: "bg-ok/10 text-ok",
  closed: "bg-surface-2 text-fg-muted",
};

export function ApprovalMailBadge({ mail }: { mail: ApprovalMail | null }) {
  const key = mailBadgeKey(mail);
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${BADGE_TONE[key]}`}>
      {copy.mailBadge[key]}
    </span>
  );
}

/** The mail's link as it is now, or null when no link was made for it. */
function linkLine(mail: ApprovalMail): string | null {
  if (!mail.linkExpiresAt) return null;
  const until = formatDateTime(mail.linkExpiresAt);
  switch (mail.linkState) {
    case "open":
      return copy.linkStateOpen(until);
    case "downloaded":
      return copy.linkStateDownloaded;
    case "expired":
      return copy.linkStateExpired(until);
    case "closed":
      return copy.linkStateClosed;
    default:
      return null;
  }
}

/**
 * Where the request stands after the approval: the approval mail (sent automatically when the approval was
 * saved), whether a Mac is registered and the latest code mail the app asked for. Sending the mail again is the
 * operator's decision: one that may already have arrived needs a second, confirming press.
 */
export default function ApprovalMailPanel({ item, onItem, onReload, lock }: ApprovalMailPanelProps) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<{ text: string; reload: boolean } | null>(null);
  // A ref, not state, so a second press before the next render can't send a second request.
  const pending = useRef(false);

  const mail = item.approvalMail;
  const intent = item.updatesApproved ? approvalMailIntent(mail) : null;
  // Asking for a second mail needs a confirmation while the first may have arrived with a link that still works.
  const mayHaveArrived = mail?.status === "uncertain" || (mail?.status === "accepted" && mail.linkState === "open");
  const link = mail ? linkLine(mail) : null;

  async function send() {
    if (pending.current || !intent || lock?.busy) return;
    if (intent === "resend" && mayHaveArrived && !confirming) {
      setConfirming(true);
      return;
    }
    if (lock && !lock.acquire()) return;
    pending.current = true;
    setBusy(true);
    setConfirming(false);
    setMessage("");
    setError(null);
    const result = await requestApprovalMail(item.id, mail?.id ?? null, intent);
    pending.current = false;
    setBusy(false);
    lock?.release();
    if (result.ok) {
      onItem(result.item);
      const status = result.item.approvalMail?.status;
      setMessage(status ? copy.approvalMailDone(APPROVAL_MAIL_STATUS_LABEL[status]) : "");
      return;
    }
    setError({ text: errorText(result), reload: result.code === "CONFLICT" || result.code === "MAIL_IN_PROGRESS" });
  }

  async function reload() {
    setError(null);
    setMessage("");
    await onReload();
  }

  return (
    <section aria-labelledby={`${id}-title`} aria-busy={busy} className="space-y-3">
      <h4 id={`${id}-title`} className="text-sm font-medium text-fg">
        {copy.progressLegend}
      </h4>
      <p className="text-sm text-fg-subtle">{copy.progressHint}</p>
      <div className="space-y-1 text-sm text-fg-muted">
        <p>
          {copy.approvalMailLegend}:{" "}
          {mail ? (
            <>
              <span className="text-fg">{APPROVAL_MAIL_STATUS_LABEL[mail.status]}</span>
              {" · "}
              <time dateTime={mail.createdAt}>{formatDateTime(mail.createdAt)}</time>{" "}
              {mail.trigger === "approval" ? copy.approvalMailAuto : copy.approvalMailManual}
              {mail.errorCode && mail.status !== "accepted" && (
                <span className="block text-fg-subtle">{copy.approvalMailReasonLine(approvalMailReason(mail.errorCode))}</span>
              )}
              {link && <span className="block text-fg-subtle">{link}</span>}
            </>
          ) : (
            <span>{item.updatesApproved ? copy.approvalMailNone : copy.approvalMailEmpty}</span>
          )}
        </p>
        <p>{item.macRegistered ? copy.macRegistered : copy.macNotRegistered}</p>
        <p>
          {item.latestCodeMail
            ? copy.codeMail(formatDateTime(item.latestCodeMail.requestedAt), CODE_MAIL_STATUS_LABEL[item.latestCodeMail.status])
            : copy.codeMailNone}
        </p>
      </div>

      {intent === "resend" && mail?.status === "accepted" && !confirming && (
        <p className="text-sm text-fg-subtle">{copy.approvalMailNewLinkHint}</p>
      )}

      {confirming && (
        <p id={`${id}-warning`} role="alert" className="rounded-[10px] border border-accent/40 p-3 text-sm text-accent-text">
          {copy.approvalMailResendWarning}
        </p>
      )}

      {error && (
        <div role="alert" className="rounded-[10px] border border-accent/40 p-3 text-sm text-accent-text">
          <p>{error.text}</p>
          {error.reload && (
            <button type="button" onClick={reload} className={`mt-2 ${BUTTON}`}>
              {copy.reload}
            </button>
          )}
        </div>
      )}

      {intent && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={send}
            aria-disabled={busy || lock?.busy}
            aria-describedby={confirming ? `${id}-warning` : undefined}
            className={BUTTON}
          >
            {busy
              ? copy.approvalMailBusy
              : confirming
                ? copy.approvalMailConfirm
                : intent === "send"
                  ? mail
                    ? copy.approvalMailSend
                    : copy.approvalMailFirst
                  : mayHaveArrived
                    ? copy.approvalMailResend
                    : copy.approvalMailNewLink}
          </button>
          {confirming && (
            <button type="button" onClick={() => setConfirming(false)} className={BUTTON}>
              {copy.approvalMailCancel}
            </button>
          )}
        </div>
      )}
      <p role="status" className="text-sm text-fg-muted">
        {busy ? copy.approvalMailBusy : message}
      </p>
    </section>
  );
}
