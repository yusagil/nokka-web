"use client";

import { useId, useRef, useState } from "react";
import { INSTALL_LINK_TTL_HOURS, type AdminApplication, type InstallLink } from "@/lib/admin/contracts";
import { issueInstallLink, revokeInstallLink, type ClientFailure } from "./api";
import { copy } from "./copy";
import { composeInstallLinkGmail, composeInstallLinkMailto, formatDateTime, installLinkMailBody } from "./format";
import type { LinkLock } from "./progress";

interface InstallLinkPanelProps {
  /** A request whose updates are allowed as saved. */
  item: AdminApplication;
  /** The request as stored after a link change (an approval mail not yet sent is cancelled by it). */
  onItem?: (item: AdminApplication) => void;
  /** The card's one-link-change-at-a-time turn, shared with the approval mail. */
  lock?: LinkLock;
}

const BUTTON =
  "inline-flex h-11 items-center justify-center rounded-full border border-line px-6 text-sm font-medium text-fg transition-colors duration-100 hover:bg-surface-2 aria-disabled:cursor-wait aria-disabled:opacity-70";

function errorText(failure: ClientFailure, fallback: string) {
  switch (failure.code) {
    case "UPDATES_NOT_APPROVED":
      return copy.installLinkNotApproved;
    case "NO_INSTALLER":
      return copy.installLinkNoInstaller;
    case "NOT_FOUND":
      return copy.notFound;
    case "UNAUTHENTICATED":
      return copy.unauthenticated;
    case "FORBIDDEN":
      return copy.forbidden;
    default:
      return fallback;
  }
}

/**
 * Issues and revokes the request's private install link. A new link's URL is held only in this
 * component's state, so it is gone once the card closes or the page reloads; the server keeps a hash.
 */
export default function InstallLinkPanel({ item, onItem, lock }: InstallLinkPanelProps) {
  const id = useId();
  const [link, setLink] = useState<InstallLink | null>(null);
  const [busy, setBusy] = useState<"issue" | "revoke" | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  // A ref, not state, so a second press before the next render can't send a second request.
  const pending = useRef(false);
  // Bumped as each request starts, so a copy that ends after it says nothing about a link that may be gone.
  const generation = useRef(0);
  // One clipboard write at a time. Writes run side by side and can finish in any order, so a slow one
  // for an old link could land after, and over, the copy of a newer one. Each write still starts in its
  // own click, where browsers allow it.
  const writing = useRef(false);
  const [copying, setCopying] = useState(false);
  const urlInput = useRef<HTMLInputElement>(null);
  // The whole draft to select by hand, shown only once the clipboard refused it.
  const [bodyShown, setBodyShown] = useState(false);
  const bodyInput = useRef<HTMLTextAreaElement>(null);

  // An approval mail sent since carries a newer link, which closed this one: its address and body are no
  // longer offered (copying them stops with them).
  const mailLinkUntil = item.approvalMail?.linkExpiresAt ?? null;
  const [mailLinkSeen, setMailLinkSeen] = useState(mailLinkUntil);
  if (mailLinkUntil !== mailLinkSeen) {
    setMailLinkSeen(mailLinkUntil);
    if (link && mailLinkUntil && Date.parse(mailLinkUntil) > Date.parse(link.expiresAt)) {
      setLink(null);
      setBodyShown(false);
      setError("");
      setMessage(copy.installLinkReplacedByMail);
    }
  }

  async function run(kind: "issue" | "revoke") {
    if (pending.current) return;
    // While an approval mail is being sent, its link would replace (or be replaced by) this one.
    if (lock && !lock.acquire()) return;
    pending.current = true;
    generation.current += 1;
    const replacing = link !== null;
    setBusy(kind);
    setMessage("");
    setError("");
    setBodyShown(false);
    if (kind === "issue") {
      const result = await issueInstallLink(item.id);
      if (result.ok) {
        setLink(result.link);
        if (result.item) onItem?.(result.item);
        // The old link is blocked now, and so is anything copied with it.
        if (replacing) setMessage(copy.installLinkReissued);
        // Focus the address so it can be copied right away.
        requestAnimationFrame(() => urlInput.current?.select());
      } else {
        setError(errorText(result, copy.installLinkIssueFailed));
      }
    } else {
      const result = await revokeInstallLink(item.id);
      if (result.ok) {
        setLink(null);
        if (result.item) onItem?.(result.item);
        setMessage(result.revoked > 0 ? copy.installLinkRevoked : copy.installLinkNoneOpen);
      } else {
        setError(errorText(result, copy.installLinkRevokeFailed));
      }
    }
    pending.current = false;
    setBusy(null);
    lock?.release();
  }

  async function copyText(text: string, copied: string, failed: () => void) {
    const started = generation.current;
    writing.current = true;
    setCopying(true);
    try {
      await navigator.clipboard.writeText(text);
      if (generation.current === started) setMessage(copied);
    } catch {
      if (generation.current === started) failed();
    } finally {
      writing.current = false;
      setCopying(false);
    }
  }

  // No copying while a request runs (the link shown may be replaced or revoked by it) or while an
  // earlier copy is still being written.
  function copyLink() {
    if (!link || pending.current || writing.current) return;
    void copyText(link.url, copy.installLinkCopied, () => {
      setMessage(copy.installLinkCopyFailed);
      urlInput.current?.select();
    });
  }

  // The link goes into a draft only by pasting: the compose links carry the recipient and subject.
  function copyBody() {
    if (!link || pending.current || writing.current) return;
    void copyText(installLinkMailBody(item.name, link.url, link.expiresAt), copy.installLinkBodyCopied, () => {
      setMessage(copy.installLinkBodyCopyFailed);
      setBodyShown(true);
      requestAnimationFrame(() => bodyInput.current?.select());
    });
  }

  return (
    <section aria-labelledby={`${id}-title`} aria-busy={busy !== null} className="space-y-3">
      <h4 id={`${id}-title`} className="text-sm font-medium text-fg">
        {copy.installLinkLegend}
      </h4>
      <p className="text-sm text-fg-subtle">{copy.installLinkHint(INSTALL_LINK_TTL_HOURS)}</p>

      {link && (
        <div className="space-y-2 rounded-[10px] border border-line p-3">
          <label htmlFor={`${id}-url`} className="text-sm font-medium text-fg">
            {copy.installLinkLabel}
          </label>
          <input
            ref={urlInput}
            id={`${id}-url`}
            type="text"
            readOnly
            value={link.url}
            onFocus={(e) => e.currentTarget.select()}
            aria-describedby={`${id}-summary`}
            className="w-full rounded-[10px] border border-line bg-bg px-4 py-3 font-mono text-sm text-fg"
          />
          <p id={`${id}-summary`} className="text-sm text-fg-subtle">
            {copy.installLinkSummary(link.version, link.build, formatDateTime(link.expiresAt))}
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <button type="button" onClick={copyLink} aria-disabled={busy !== null || copying} className={BUTTON}>
              {copy.installLinkCopy}
            </button>
            <button
              type="button"
              onClick={copyBody}
              aria-disabled={busy !== null || copying}
              aria-describedby={`${id}-compose-hint`}
              className={BUTTON}
            >
              {copy.installLinkCopyBody}
            </button>
          </div>
          {bodyShown && (
            <div className="space-y-2">
              <label htmlFor={`${id}-body`} className="text-sm font-medium text-fg">
                {copy.installLinkBodyLabel}
              </label>
              <textarea
                ref={bodyInput}
                id={`${id}-body`}
                readOnly
                rows={8}
                value={installLinkMailBody(item.name, link.url, link.expiresAt)}
                onFocus={(e) => e.currentTarget.select()}
                className="w-full resize-y rounded-[10px] border border-line bg-bg px-4 py-3 text-sm leading-relaxed text-fg"
              />
            </div>
          )}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            {/* A new tab, so this page and the address it shows stay open. */}
            <a
              href={composeInstallLinkGmail(item.email)}
              target="_blank"
              rel="noopener noreferrer"
              aria-describedby={`${id}-compose-hint`}
              className={BUTTON}
            >
              {copy.installLinkComposeGmail}
            </a>
            <a
              href={composeInstallLinkMailto(item.email)}
              aria-describedby={`${id}-compose-hint`}
              className={BUTTON}
            >
              {copy.installLinkCompose}
            </a>
          </div>
          <p id={`${id}-compose-hint`} className="text-sm text-fg-subtle">
            {copy.installLinkComposeHint}
          </p>
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-[10px] border border-accent/40 p-3 text-sm text-accent-text">
          <p>{error}</p>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <button type="button" onClick={() => run("issue")} aria-disabled={busy !== null || lock?.busy} className={BUTTON}>
          {busy === "issue" ? copy.installLinkIssuing : link ? copy.installLinkReissue : copy.installLinkIssue}
        </button>
        <button
          type="button"
          onClick={() => run("revoke")}
          aria-disabled={busy !== null || lock?.busy}
          aria-describedby={`${id}-revoke-hint`}
          className={BUTTON}
        >
          {busy === "revoke" ? copy.installLinkRevoking : copy.installLinkRevoke}
        </button>
      </div>
      <p id={`${id}-revoke-hint`} className="text-sm text-fg-subtle">
        {copy.installLinkRevokeHint}
      </p>
      <p role="status" className="text-sm text-fg-muted">
        {message}
      </p>
    </section>
  );
}
