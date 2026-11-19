"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { Dictionary } from "@/dictionaries";
import {
  APPLICATIONS_ENDPOINT,
  type ApplicationField,
  type ApplicationResult,
  type FieldError,
  type FieldErrors,
} from "@/lib/applications/contracts";
import { validateApplication } from "@/lib/applications/validation";

// Past this, the request may or may not have been stored, so the form says it couldn't confirm it.
const TIMEOUT_MS = 20_000;

type FormDict = Dictionary["apply"]["form"];
type Status = "idle" | "submitting" | "failed" | "done";
type Messages = Partial<Record<ApplicationField, string>>;

interface ApplicationFormProps {
  dict: FormDict;
  className?: string;
}

const FIELD_MESSAGE: Record<ApplicationField, Record<FieldError, keyof FormDict["errors"]>> = {
  name: { REQUIRED: "nameRequired", TOO_LONG: "nameTooLong", INVALID: "nameInvalid" },
  email: { REQUIRED: "emailRequired", TOO_LONG: "emailTooLong", INVALID: "emailInvalid" },
};
const FIELD_ERRORS: readonly unknown[] = ["REQUIRED", "TOO_LONG", "INVALID"] satisfies FieldError[];

/** Messages for the field errors we recognise; unknown fields or codes are dropped. */
function fieldMessages(errors: FieldErrors | undefined, dict: FormDict["errors"]): Messages {
  const messages: Messages = {};
  for (const field of ["name", "email"] as const) {
    const error = errors?.[field];
    if (FIELD_ERRORS.includes(error)) messages[field] = dict[FIELD_MESSAGE[field][error!]];
  }
  return messages;
}

/** 200 with { ok: true } is the only success; everything else, including unreadable bodies, is not. */
async function readResult(response: Response): Promise<ApplicationResult | null> {
  try {
    return (await response.json()) as ApplicationResult;
  } catch {
    return null;
  }
}

export default function ApplicationForm({ dict, className = "" }: ApplicationFormProps) {
  const id = useId();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Messages>({});
  const [formError, setFormError] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  // A ref, not state, so a second press before the next render can't send a second request.
  const pending = useRef(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const emailInput = useRef<HTMLInputElement>(null);
  const doneHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (status === "done") doneHeading.current?.focus();
  }, [status]);

  const showFieldErrors = (messages: Messages) => {
    setStatus("idle");
    setFieldErrors(messages);
    if (messages.name) nameInput.current?.focus();
    else if (messages.email) emailInput.current?.focus();
  };

  const fail = (message: string) => {
    setStatus("failed");
    setFormError(message);
  };

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;

    setFormError("");
    const checked = validateApplication({ name, email });
    if (!checked.ok) {
      showFieldErrors(fieldMessages(checked.fieldErrors, dict.errors));
      return;
    }

    pending.current = true;
    setFieldErrors({});
    setStatus("submitting");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(APPLICATIONS_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(checked.value),
        signal: controller.signal,
      });
      const result = await readResult(response);

      const serverFields =
        result?.ok === false && result.code === "VALIDATION_ERROR"
          ? fieldMessages(result.fieldErrors, dict.errors)
          : {};

      if (response.status === 200 && result?.ok === true) {
        setStatus("done");
      } else if (serverFields.name || serverFields.email) {
        showFieldErrors(serverFields);
      } else if (result?.ok === false && result.code === "RATE_LIMITED") {
        fail(dict.errors.rateLimited);
      } else if (result?.ok === false && result.code === "PAYLOAD_TOO_LARGE") {
        fail(dict.errors.tooLarge);
      } else if (
        result?.ok === false &&
        ["INVALID_REQUEST", "FORBIDDEN", "UNSUPPORTED_MEDIA_TYPE"].includes(result.code)
      ) {
        fail(dict.errors.rejected);
      } else {
        // UNAVAILABLE, INTERNAL_ERROR, a VALIDATION_ERROR without a field error we recognise,
        // or a response we can't read.
        fail(dict.errors.unconfirmed);
      }
    } catch {
      // Network failure or timeout: the request may still have been stored.
      fail(dict.errors.unconfirmed);
    } finally {
      clearTimeout(timer);
      pending.current = false;
    }
  }

  const submitting = status === "submitting";

  return (
    <div className={className}>
      <p role="status" className="sr-only">
        {submitting ? dict.submitting : ""}
      </p>

      {status === "done" ? (
        <div className="rounded-[14px] border border-line bg-surface p-6 text-center md:p-8">
          <h3
            ref={doneHeading}
            tabIndex={-1}
            className="text-xl font-semibold text-fg focus:outline-none"
          >
            {dict.doneHeading}
          </h3>
          <p className="mt-2 text-pretty leading-relaxed text-fg-muted">{dict.doneBody}</p>
        </div>
      ) : (
        <form
          method="post"
          action={APPLICATIONS_ENDPOINT}
          noValidate
          onSubmit={handleSubmit}
          aria-busy={submitting}
          className="space-y-5 rounded-[14px] border border-line bg-surface p-5 text-left md:p-6"
        >
          <div>
            <label htmlFor={`${id}-name`} className="text-sm font-medium text-fg">
              {dict.nameLabel}
            </label>
            <input
              ref={nameInput}
              id={`${id}-name`}
              name="name"
              type="text"
              autoComplete="name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (fieldErrors.name) setFieldErrors((prev) => ({ ...prev, name: undefined }));
              }}
              aria-invalid={fieldErrors.name ? true : undefined}
              aria-describedby={fieldErrors.name ? `${id}-name-error` : undefined}
              className="mt-2 h-12 w-full rounded-[10px] border border-line bg-bg px-4 text-base text-fg aria-[invalid=true]:border-accent"
            />
            {fieldErrors.name && (
              <p id={`${id}-name-error`} className="mt-2 text-sm text-accent-text">
                {fieldErrors.name}
              </p>
            )}
          </div>

          <div>
            <label htmlFor={`${id}-email`} className="text-sm font-medium text-fg">
              {dict.emailLabel}
            </label>
            <input
              ref={emailInput}
              id={`${id}-email`}
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (fieldErrors.email) setFieldErrors((prev) => ({ ...prev, email: undefined }));
              }}
              aria-invalid={fieldErrors.email ? true : undefined}
              aria-describedby={fieldErrors.email ? `${id}-email-error` : undefined}
              className="mt-2 h-12 w-full rounded-[10px] border border-line bg-bg px-4 text-base text-fg aria-[invalid=true]:border-accent"
            />
            {fieldErrors.email && (
              <p id={`${id}-email-error`} className="mt-2 text-sm text-accent-text">
                {fieldErrors.email}
              </p>
            )}
          </div>

          <p className="text-sm leading-relaxed text-fg-subtle">{dict.purpose}</p>

          {formError && (
            <p role="alert" className="text-sm text-accent-text">
              {formError}
            </p>
          )}

          <button
            type="submit"
            aria-disabled={submitting}
            className="inline-flex h-12 w-full items-center justify-center rounded-full bg-accent-strong px-7 text-base font-medium text-white shadow-sm transition-colors duration-150 hover:bg-accent-stronger aria-disabled:cursor-wait aria-disabled:opacity-70"
          >
            {submitting ? dict.submitting : dict.submit}
          </button>
        </form>
      )}
    </div>
  );
}
