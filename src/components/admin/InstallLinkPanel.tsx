"use client";

import { useId, useRef, useState } from "react";
import { INSTALL_LINK_TTL_HOURS, type AdminApplication, type InstallLink } from "@/lib/admin/contracts";
import { issueInstallLink, revokeInstallLink, type ClientFailure } from "./api";
import { copy } from "./copy";
import { composeInstallLinkMailto, formatDateTime } from "./format";

interface InstallLinkPanelProps {
  /** A request whose updates are allowed as saved. */
  item: AdminApplication;
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
export default function InstallLinkPanel({ item }: InstallLinkPanelProps) {
  const id = useId();
  const [link, setLink] = useState<InstallLink | null>(null);
  const [busy, setBusy] = useState<"issue" | "revoke" | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  // A ref, not state, so a second press before the next render can't send a second request.
  const pending = useRef(false);
  const urlInput = useRef<HTMLInputElement>(null);

  async function run(kind: "issue" | "revoke") {
    if (pending.current) return;
    pending.current = true;
    setBusy(kind);
    setMessage("");
    setError("");
    if (kind === "issue") {
      const result = await issueInstallLink(item.id);
      if (result.ok) {
        setLink(result.link);
        // Focus the address so it can be copied right away.
        requestAnimationFrame(() => urlInput.current?.select());
      } else {
        setError(errorText(result, copy.installLinkIssueFailed));
      }
    } else {
      const result = await revokeInstallLink(item.id);
      if (result.ok) {
        setLink(null);
        setMessage(result.revoked > 0 ? copy.installLinkRevoked : copy.installLinkNoneOpen);
      } else {
        setError(errorText(result, copy.installLinkRevokeFailed));
      }
    }
    pending.current = false;
    setBusy(null);
  }

  async function copyLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setMessage(copy.installLinkCopied);
    } catch {
      setMessage(copy.installLinkCopyFailed);
      urlInput.current?.select();
    }
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
            <button type="button" onClick={copyLink} className={BUTTON}>
              {copy.installLinkCopy}
            </button>
            <a
              href={composeInstallLinkMailto(item.name, item.email, link.url, link.expiresAt)}
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
        <button type="button" onClick={() => run("issue")} aria-disabled={busy !== null} className={BUTTON}>
          {busy === "issue" ? copy.installLinkIssuing : link ? copy.installLinkReissue : copy.installLinkIssue}
        </button>
        <button
          type="button"
          onClick={() => run("revoke")}
          aria-disabled={busy !== null}
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
