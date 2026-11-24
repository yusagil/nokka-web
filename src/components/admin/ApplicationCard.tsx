"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  APPLICATION_STATUSES,
  NOTE_MAX_LENGTH,
  validateOperatorNote,
  type AdminApplication,
  type ApplicationPatch,
  type ApplicationStatus,
  type FieldError,
} from "@/lib/admin/contracts";
import { updateApplication } from "./api";
import ApprovalMailPanel, { ApprovalMailBadge } from "./ApprovalMailPanel";
import { APPROVAL_MAIL_STATUS_LABEL, STATUS_LABEL, copy } from "./copy";
import { composeGmail, composeMailto, formatDateTime } from "./format";
import InstallLinkPanel from "./InstallLinkPanel";
import { mergeProgress, type LinkLock } from "./progress";

interface ApplicationCardProps {
  item: AdminApplication;
  expanded: boolean;
  onToggle: () => void;
  /** `stillEditing`: the operator changed the form while the save was in flight, so it isn't clean. */
  onSaved: (item: AdminApplication, stillEditing: boolean) => void;
  /**
   * An action's answer (`read`) for request `id`, to merge into the list's row as it is when the answer lands
   * (see mergeProgress). Without it the card merges into the item it rendered last.
   */
  onProgress?: (id: string, read: AdminApplication) => void;
  /** Reloads the list; resolves once the fresh items are in. */
  onReload: () => Promise<void>;
  /** Told whether this card holds edits that aren't saved yet. */
  onDirtyChange?: (id: string, dirty: boolean) => void;
}

const noteError = (error: FieldError) =>
  error === "TOO_LONG" ? copy.noteTooLong(NOTE_MAX_LENGTH) : copy.noteInvalid;

const BADGE: Record<ApplicationStatus, string> = {
  new: "bg-accent-soft text-accent-text",
  hold: "bg-[#ff9f0a]/10 text-[#ffb340]",
  contacted: "bg-ok/10 text-ok",
};

export function StatusBadge({ status }: { status: ApplicationStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${BADGE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export default function ApplicationCard({
  item,
  expanded,
  onToggle,
  onSaved,
  onProgress,
  onReload,
  onDirtyChange,
}: ApplicationCardProps) {
  const id = useId();
  const savedNote = item.operatorNote;
  const [status, setStatus] = useState(item.status);
  const [note, setNote] = useState(savedNote);
  const [updatesApproved, setUpdatesApproved] = useState(item.updatesApproved);
  const [noteMessage, setNoteMessage] = useState("");
  const [error, setError] = useState<{ text: string; reload?: boolean } | null>(null);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  // A ref, not state, so a second press before the next render can't send a second request.
  const pending = useRef(false);
  const noteInput = useRef<HTMLTextAreaElement>(null);
  const saveButton = useRef<HTMLButtonElement>(null);

  // When the stored record changes underneath (a reload), start over from it.
  const [base, setBase] = useState(item.updatedAt);
  if (item.updatedAt !== base) {
    setBase(item.updatedAt);
    setStatus(item.status);
    setNote(savedNote);
    setUpdatesApproved(item.updatesApproved);
    setNoteMessage("");
    setError(null);
  }

  const dirty = status !== item.status || note !== savedNote || updatesApproved !== item.updatesApproved;
  // The draft as of the last render, read when a save returns to see what changed meanwhile.
  const latest = useRef({ status, note, updatesApproved });
  useEffect(() => {
    latest.current = { status, note, updatesApproved };
  }, [status, note, updatesApproved]);
  useEffect(() => {
    onDirtyChange?.(item.id, dirty);
  }, [onDirtyChange, item.id, dirty]);
  useEffect(() => () => onDirtyChange?.(item.id, false), [onDirtyChange, item.id]);

  const showNoteError = (text: string) => {
    setNoteMessage(text);
    noteInput.current?.focus();
  };

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    setMessage("");
    setError(null);
    if (!dirty) {
      setMessage(copy.noChanges);
      return;
    }
    const invalidNote = validateOperatorNote(note);
    if (invalidNote) {
      showNoteError(noteError(invalidNote));
      return;
    }

    pending.current = true;
    setSaving(true);
    setNoteMessage("");
    const sent = { status, note, updatesApproved };
    const patch: ApplicationPatch = { expectedUpdatedAt: item.updatedAt };
    if (status !== item.status) patch.status = status;
    if (note !== savedNote) patch.operatorNote = note;
    if (updatesApproved !== item.updatesApproved) patch.updatesApproved = updatesApproved;
    const result = await updateApplication(item.id, patch);
    pending.current = false;
    setSaving(false);

    if (result.ok) {
      // Only now, with the stored record back from the server, is the change shown as saved.
      // Fields edited while the request was in flight keep the newer draft, left unsaved.
      const statusEdited = latest.current.status !== sent.status;
      const noteEdited = latest.current.note !== sent.note;
      const updatesEdited = latest.current.updatesApproved !== sent.updatesApproved;
      const edited = statusEdited || noteEdited || updatesEdited;
      setBase(result.item.updatedAt);
      if (!statusEdited) setStatus(result.item.status);
      if (!noteEdited) setNote(result.item.operatorNote);
      if (!updatesEdited) setUpdatesApproved(result.item.updatesApproved);
      // Turning updates on sent the approval mail before the answer came back: say how it went.
      const mail = patch.updatesApproved === true ? result.item.approvalMail : null;
      setMessage(
        edited ? copy.savedWithPending : mail ? copy.savedWithMail(APPROVAL_MAIL_STATUS_LABEL[mail.status]) : copy.saved,
      );
      onSaved(result.item, edited);
      return;
    }
    switch (result.code) {
      case "CONFLICT":
        setError({ text: copy.conflict, reload: true });
        break;
      case "NOT_FOUND":
        setError({ text: copy.notFound, reload: true });
        break;
      case "UNAUTHENTICATED":
        setError({ text: copy.unauthenticated });
        break;
      case "FORBIDDEN":
        setError({ text: copy.forbidden });
        break;
      case "PAYLOAD_TOO_LARGE":
        showNoteError(copy.noteTooLong(NOTE_MAX_LENGTH));
        break;
      default:
        if (result.code === "VALIDATION_ERROR" && result.fieldErrors?.operatorNote) {
          showNoteError(noteError(result.fieldErrors.operatorNote));
        } else {
          setError({ text: copy.saveFailed });
        }
    }
  }

  async function reload() {
    await onReload();
    saveButton.current?.focus();
  }

  // A mail or link action answers with the request as stored then: only its progress is taken, into the row as
  // it is when the answer lands, so a save that ended meanwhile (a withdrawal, say) stays as saved.
  const applyProgress = (read: AdminApplication) =>
    onProgress ? onProgress(item.id, read) : onSaved(mergeProgress(item, read), dirty);

  // One link change at a time on this card (see LinkLock). A ref, so two presses in one frame can't both get it.
  const linkTaken = useRef(false);
  const [linkBusy, setLinkBusy] = useState(false);
  const linkLock: LinkLock = {
    busy: linkBusy,
    acquire() {
      if (linkTaken.current) return false;
      linkTaken.current = true;
      setLinkBusy(true);
      return true;
    },
    release() {
      linkTaken.current = false;
      setLinkBusy(false);
    },
  };

  const noteDescribedBy = [`${id}-note-hint`, `${id}-note-count`, noteMessage && `${id}-note-error`]
    .filter(Boolean)
    .join(" ");
  // The server stores the note trimmed, so count and limit what it will keep.
  const noteLength = note.trim().length;

  return (
    <li className="rounded-[14px] border border-line bg-surface">
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between md:p-5">
        <div className="min-w-0">
          <h3 className="break-words text-base font-semibold text-fg">{item.name}</h3>
          <p className="mt-0.5 break-all text-sm text-fg-muted">{item.email}</p>
          <p className="mt-2 text-sm text-fg-subtle">
            {copy.appliedAt} <time dateTime={item.createdAt}>{formatDateTime(item.createdAt)}</time>
            {item.lastContactedAt && (
              <>
                {" · "}
                {copy.lastContactedAt}{" "}
                <time dateTime={item.lastContactedAt}>{formatDateTime(item.lastContactedAt)}</time>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center justify-between gap-3 sm:shrink-0 sm:justify-end">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={item.status} />
            {item.updatesApproved && (
              <span className="inline-flex items-center rounded-full bg-ok/10 px-2.5 py-1 text-xs font-medium text-ok">
                {copy.updatesApprovedBadge}
              </span>
            )}
            {item.updatesApproved && <ApprovalMailBadge mail={item.approvalMail} />}
          </div>
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={`${id}-panel`}
            // Starts with the visible text, so voice control still matches it.
            aria-label={`${expanded ? copy.close : copy.open} ${item.name}`}
            onClick={onToggle}
            className="inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm font-medium text-fg transition-colors duration-100 hover:bg-surface-2"
          >
            {expanded ? copy.close : copy.open}
          </button>
        </div>
      </div>

      <form
        id={`${id}-panel`}
        hidden={!expanded}
        onSubmit={save}
        aria-busy={saving}
        className="space-y-5 border-t border-line-subtle p-4 md:p-5"
      >
        <fieldset>
          <legend className="text-sm font-medium text-fg">{copy.statusLegend}</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {APPLICATION_STATUSES.map((value) => (
              <label
                key={value}
                className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-line px-4 text-sm text-fg-muted has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:checked]:text-fg has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent"
              >
                <input
                  type="radio"
                  name={`${id}-status`}
                  value={value}
                  checked={status === value}
                  onChange={() => setStatus(value)}
                  className="accent-accent focus-visible:outline-none"
                />
                {STATUS_LABEL[value]}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-sm font-medium text-fg">{copy.updatesLegend}</legend>
          <label className="mt-2 inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-line px-4 text-sm text-fg-muted has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:checked]:text-fg has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent">
            <input
              type="checkbox"
              checked={updatesApproved}
              onChange={(e) => setUpdatesApproved(e.target.checked)}
              aria-describedby={`${id}-updates-hint`}
              className="accent-accent focus-visible:outline-none"
            />
            {copy.updatesLabel}
          </label>
          <p id={`${id}-updates-hint`} className="mt-1 text-sm text-fg-subtle">
            {item.updatesApproved && !updatesApproved ? copy.updatesRevokeWarning : copy.updatesHint}
          </p>
        </fieldset>

        <ApprovalMailPanel item={item} onItem={applyProgress} onReload={onReload} lock={linkLock} />

        {/* Only for an approval that is saved: the server checks the stored one. */}
        {item.updatesApproved && <InstallLinkPanel item={item} onItem={applyProgress} lock={linkLock} />}

        <div>
          <label htmlFor={`${id}-note`} className="text-sm font-medium text-fg">
            {copy.noteLabel}
          </label>
          <p id={`${id}-note-hint`} className="mt-1 text-sm text-fg-subtle">
            {copy.noteHint}
          </p>
          <textarea
            ref={noteInput}
            id={`${id}-note`}
            rows={4}
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              if (noteMessage) setNoteMessage("");
            }}
            aria-invalid={noteMessage ? true : undefined}
            aria-describedby={noteDescribedBy}
            className="mt-2 w-full resize-y rounded-[10px] border border-line bg-bg px-4 py-3 text-base leading-relaxed text-fg aria-[invalid=true]:border-accent"
          />
          <div className="mt-1 flex items-start justify-between gap-4 text-sm">
            <p id={`${id}-note-error`} className="text-accent-text">
              {noteMessage}
            </p>
            <p
              id={`${id}-note-count`}
              className={`shrink-0 tabular-nums ${noteLength > NOTE_MAX_LENGTH ? "text-accent-text" : "text-fg-subtle"}`}
            >
              {copy.noteCount(noteLength, NOTE_MAX_LENGTH)}
            </p>
          </div>
        </div>

        {error && (
          <div role="alert" className="rounded-[10px] border border-accent/40 p-3 text-sm text-accent-text">
            <p>{error.text}</p>
            {error.reload && (
              <button
                type="button"
                onClick={reload}
                className="mt-2 inline-flex min-h-11 items-center rounded-full border border-line px-4 font-medium text-fg hover:bg-surface-2"
              >
                {copy.reload}
              </button>
            )}
          </div>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <button
            ref={saveButton}
            type="submit"
            aria-disabled={saving}
            className="inline-flex h-11 items-center justify-center rounded-full bg-accent-strong px-6 text-sm font-medium text-white transition-colors duration-150 hover:bg-accent-stronger aria-disabled:cursor-wait aria-disabled:opacity-70"
          >
            {saving ? copy.saving : copy.save}
          </button>
          <a
            href={composeGmail(item.name, item.email)}
            target="_blank"
            rel="noopener noreferrer"
            aria-describedby={`${id}-compose-hint`}
            className="inline-flex h-11 items-center justify-center rounded-full border border-line px-6 text-sm font-medium text-fg transition-colors duration-100 hover:bg-surface-2"
          >
            {copy.composeGmail}
          </a>
          <a
            href={composeMailto(item.name, item.email)}
            aria-describedby={`${id}-compose-hint`}
            className="inline-flex h-11 items-center justify-center rounded-full border border-line px-6 text-sm font-medium text-fg transition-colors duration-100 hover:bg-surface-2"
          >
            {copy.compose}
          </a>
        </div>
        <p id={`${id}-compose-hint`} className="text-sm text-fg-subtle">
          {copy.composeHint}
        </p>
        <p role="status" className="text-sm text-fg-muted">
          {saving ? copy.saving : message}
        </p>
      </form>
    </li>
  );
}
