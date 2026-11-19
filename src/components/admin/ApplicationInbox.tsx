"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  APPLICATION_STATUSES,
  SEARCH_MAX_LENGTH,
  type AdminApplication,
  type StatusFilter,
} from "@/lib/admin/contracts";
import { searchApplications, type ClientFailure } from "./api";
import ApplicationCard from "./ApplicationCard";
import { STATUS_LABEL, copy } from "./copy";
import SignOutButton from "./SignOutButton";

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: copy.filterAll },
  ...APPLICATION_STATUSES.map((value) => ({ value, label: STATUS_LABEL[value] })),
];

function loadErrorText(code: ClientFailure["code"]): string {
  if (code === "UNAUTHENTICATED") return copy.unauthenticated;
  if (code === "FORBIDDEN") return copy.forbidden;
  return copy.loadFailed;
}

type Page =
  | { key: string; ok: true; items: AdminApplication[]; nextCursor: string | null }
  | { key: string; ok: false; error: string };

export default function ApplicationInbox() {
  const id = useId();
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [reloads, setReloads] = useState(0);
  const [page, setPage] = useState<Page | null>(null);
  const [more, setMore] = useState<{ key: string; state: "loading" | "failed" } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [unsaved, setUnsaved] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<{ key: string; text: string } | null>(null);
  const reloadWaiters = useRef<(() => void)[]>([]);
  const listHeading = useRef<HTMLHeadingElement>(null);
  // Set when a card leaves the list; its focused button goes with it, so focus moves to the heading.
  const focusListHeading = useRef(false);

  useEffect(() => {
    if (focusListHeading.current) {
      focusListHeading.current = false;
      listHeading.current?.focus();
    }
  });

  const trackUnsaved = useCallback((itemId: string, dirty: boolean) => {
    setUnsaved((prev) => {
      if (prev.has(itemId) === dirty) return prev;
      const next = new Set(prev);
      if (dirty) next.add(itemId);
      else next.delete(itemId);
      return next;
    });
  }, []);

  // Every search, filter change or reload is a new key; the list is loading until a page for it lands.
  const key = JSON.stringify([query, filter, reloads]);

  useEffect(() => {
    const controller = new AbortController();
    searchApplications({ q: query, status: filter, signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      // A failed load shows nothing rather than the previous filter's list.
      setPage(
        result.ok
          ? { key, ok: true, items: result.items, nextCursor: result.nextCursor }
          : { key, ok: false, error: loadErrorText(result.code) }
      );
      const waiters = reloadWaiters.current;
      reloadWaiters.current = [];
      waiters.forEach((resolve) => resolve());
    });
    return () => controller.abort();
  }, [key, query, filter]);

  const reload = useCallback(
    () =>
      new Promise<void>((resolve) => {
        reloadWaiters.current.push(resolve);
        setReloads((n) => n + 1);
      }),
    []
  );

  const phase = page?.key !== key ? "loading" : page.ok ? "ready" : "failed";
  const items = page?.ok ? page.items : [];
  const nextCursor = page?.ok ? page.nextCursor : null;
  const moreState = more?.key === key ? more.state : "idle";

  async function loadMore() {
    if (!nextCursor || moreState === "loading") return;
    const pageKey = key;
    setMore({ key: pageKey, state: "loading" });
    const result = await searchApplications({ q: query, status: filter, cursor: nextCursor });
    if (!result.ok) {
      setMore({ key: pageKey, state: "failed" });
      return;
    }
    setMore(null);
    setPage((prev) =>
      prev?.ok && prev.key === pageKey
        ? { ...prev, items: [...prev.items, ...result.items], nextCursor: result.nextCursor }
        : prev
    );
  }

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setQuery(queryInput.trim());
  }

  const applySaved = (updated: AdminApplication, stillEditing: boolean) => {
    // Saved into another status, the request no longer belongs to this filter's list. One that still
    // has edits made during the save stays, so those edits aren't lost with it.
    const leaves = filter !== "all" && updated.status !== filter && !stillEditing;
    setPage((prev) =>
      prev?.ok
        ? {
            ...prev,
            items: leaves
              ? prev.items.filter((item) => item.id !== updated.id)
              : prev.items.map((item) => (item.id === updated.id ? updated : item)),
          }
        : prev
    );
    setNotice(leaves ? { key, text: copy.movedOut(STATUS_LABEL[updated.status]) } : null);
    if (leaves) focusListHeading.current = true;
  };

  const filtered = query !== "" || filter !== "all";
  // Searching or filtering replaces the cards, so their unsaved edits would go with them.
  const unsavedNote = unsaved.size > 0 ? `${id}-unsaved` : undefined;
  const statusText =
    phase === "loading"
      ? copy.loading
      : phase === "ready"
        ? items.length === 0
          ? filtered
            ? copy.emptyFiltered
            : copy.empty
          : copy.count(items.length, nextCursor !== null)
        : "";

  return (
    <div className="mx-auto max-w-[880px] px-4 py-10 md:px-8 md:py-14">
      <div className="flex items-start justify-between gap-4">
        <h1 className="text-[28px] font-bold tracking-[-0.02em] text-fg md:text-[32px]">{copy.title}</h1>
        <SignOutButton />
      </div>
      <p className="mt-2 text-pretty text-fg-muted">{copy.intro}</p>

      <div className="mt-8 space-y-4">
        <form role="search" onSubmit={search}>
          <label htmlFor={`${id}-q`} className="text-sm font-medium text-fg">
            {copy.searchLabel}
          </label>
          <div className="mt-2 flex gap-2">
            <input
              id={`${id}-q`}
              type="search"
              maxLength={SEARCH_MAX_LENGTH}
              autoComplete="off"
              spellCheck={false}
              value={queryInput}
              onChange={(e) => setQueryInput(e.target.value)}
              className="h-11 min-w-0 flex-1 rounded-[10px] border border-line bg-bg px-4 text-base text-fg"
            />
            <button
              type="submit"
              aria-describedby={unsavedNote}
              className="inline-flex h-11 shrink-0 items-center rounded-full border border-line px-5 text-sm font-medium text-fg transition-colors duration-100 hover:bg-surface-2"
            >
              {copy.search}
            </button>
          </div>
        </form>

        <fieldset aria-describedby={unsavedNote}>
          <legend className="text-sm font-medium text-fg">{copy.filterLegend}</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {FILTERS.map(({ value, label }) => (
              <label
                key={value}
                className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-line px-4 text-sm text-fg-muted has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:checked]:text-fg has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent"
              >
                <input
                  type="radio"
                  name={`${id}-filter`}
                  value={value}
                  checked={filter === value}
                  onChange={() => setFilter(value)}
                  className="accent-accent focus-visible:outline-none"
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>

        {unsavedNote && (
          <p id={unsavedNote} className="text-sm text-[#ffb340]">
            {copy.unsaved}
          </p>
        )}
      </div>

      <section aria-labelledby={`${id}-list`} className="mt-10">
        <div className="flex items-baseline justify-between gap-4">
          <h2
            ref={listHeading}
            id={`${id}-list`}
            tabIndex={-1}
            className="text-lg font-semibold text-fg focus:outline-none"
          >
            {copy.listHeading}
          </h2>
          <p role="status" className="text-sm text-fg-subtle">
            {statusText}
          </p>
        </div>
        <p aria-live="polite" className="mt-2 text-sm text-fg-muted">
          {notice?.key === key ? notice.text : ""}
        </p>

        {page && !page.ok && phase === "failed" && (
          <div role="alert" className="mt-4 rounded-[10px] border border-accent/40 p-4 text-sm text-accent-text">
            <p>{page.error}</p>
            <button
              type="button"
              onClick={() => setReloads((n) => n + 1)}
              className="mt-3 inline-flex min-h-11 items-center rounded-full border border-line px-4 font-medium text-fg hover:bg-surface-2"
            >
              {copy.retry}
            </button>
          </div>
        )}

        {items.length > 0 && (
          <ul aria-busy={phase === "loading"} className="mt-4 space-y-3 aria-busy:opacity-60">
            {items.map((item) => {
              const key = String(item.id);
              return (
                <ApplicationCard
                  key={key}
                  item={item}
                  expanded={expanded === key}
                  onToggle={() => setExpanded((open) => (open === key ? null : key))}
                  onSaved={applySaved}
                  onReload={reload}
                  onDirtyChange={trackUnsaved}
                />
              );
            })}
          </ul>
        )}

        {phase === "ready" && nextCursor && (
          <div className="mt-6 flex flex-col items-center gap-2">
            {moreState === "failed" && (
              <p role="alert" className="text-sm text-accent-text">
                {copy.loadFailed}
              </p>
            )}
            <button
              type="button"
              onClick={loadMore}
              aria-disabled={moreState === "loading"}
              className="inline-flex min-h-11 items-center rounded-full border border-line px-5 text-sm font-medium text-fg transition-colors duration-100 hover:bg-surface-2 aria-disabled:cursor-wait aria-disabled:opacity-70"
            >
              {moreState === "loading"
                ? copy.loadingMore
                : moreState === "failed"
                  ? copy.retry
                  : copy.loadMore}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
