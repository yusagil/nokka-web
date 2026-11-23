"use client";

import { useEffect, useRef, useState } from "react";
import {
  INSTALL_REF_PATTERN,
  INSTALL_SESSION_ENDPOINT,
  INSTALL_TOKEN_PATTERN,
  installDownloadPath,
  type InstallSessionResult,
} from "@/lib/update-packages/install-contracts";
import { replaceEntry } from "./entry";

/** What a link opens: the session answer without `ok`. */
type Link = Omit<InstallSessionResult, "ok">;

type State =
  | { kind: "checking" }
  /** No usable token in the fragment, and nothing to show again in this entry. */
  | { kind: "missing" }
  /** Unknown, expired, revoked or replaced. */
  | { kind: "closed" }
  /**
   * Opened before (a link opens once), and this browser can not show its download (yet). `key` names the
   * link here, so its download shows as soon as another tab of this browser keeps it.
   */
  | { kind: "used"; key?: string }
  | { kind: "error" }
  | { kind: "ready"; link: Link };

/** A final answer, kept in the entry's own history state for a reload, back or forward. Nothing secret. */
type Shown = Extract<State, { kind: "closed" | "used" | "ready" }>;
const SHOWN_STATE = "nokkaInstall";
// A link opens once: its first answer sets the download cookie, and the server refuses it after that. What
// it opened is kept for this browser under the SHA-256 of its token (never the token itself), one key per
// link, so the same link opened again here shows its download for as long as that cookie still opens it.
const OPENED_PREFIX = "nokka-install-opened:";
const KEY_PATTERN = /^[0-9a-f]{64}$/;
// The token's way from the page that read it to the page loaded in place of its entry: window.name stays
// with the tab across a same-origin load and is never sent or stored by the browser. The marker proves
// this tab sent it; a marker without a token means this browser dropped it, and links are then checked
// in place.
const HANDOVER_PREFIX = "nokka-install:";
const HANDOVER_KEY = "nokka-install-handover";
const NO_HANDOVER_KEY = "nokka-install-no-handover";

// Korean first, English below it, like the app's own registration mail.
const copy = {
  title: "Nokka 설치 파일",
  titleEn: "Nokka installer",
  noscript: "이 페이지는 JavaScript가 필요합니다.",
  noscriptEn: "This page needs JavaScript.",
  checking: "링크를 확인하는 중…",
  checkingEn: "Checking the link…",
  missing: "링크 주소가 완전하지 않습니다. 받은 링크를 그대로 다시 열어 주세요.",
  missingEn: "The link address is incomplete. Open the link you received again, exactly as it is.",
  closed: "이 설치 링크는 사용할 수 없습니다. 유효 기간이 지났거나, 회수되었거나, 새 링크로 바뀌었습니다. 새 링크가 필요합니다.",
  closedEn: "This install link can't be used: it has expired, was revoked or was replaced by a newer one. You need a new link.",
  used: "이 설치 링크는 이미 열렸습니다. 링크는 한 번만 열 수 있어, 처음 연 브라우저에서만 받을 수 있습니다. 그 브라우저에서도 다운로드가 보이지 않으면 새 링크가 필요합니다.",
  usedEn:
    "This install link was already opened. A link opens once, so only the browser that opened it first can download. If the download doesn't show there either, you need a new link.",
  error: "지금은 링크를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  errorEn: "The link couldn't be checked right now. Please try again in a moment.",
  retry: "다시 시도 (Try again)",
  summary: (version: string, build: number, size: string) => `Nokka ${version} (${build}) · ${size}`,
  until: (date: string) =>
    `${date}까지 받을 수 있습니다. 링크는 처음 연 브라우저에서만 쓸 수 있으니, 받는 중에 끊기면 이 기간 안에 이 브라우저에서 이 페이지나 받은 링크를 다시 열어 받으세요.`,
  untilEn: (date: string) =>
    `You can download it until ${date}. The link works only in the browser that opened it first: if the download stops, open this page or the link again in this browser before then.`,
  download: "설치 파일 받기 (Download)",
  share: "이 링크는 받은 분만 쓸 수 있습니다. 다른 사람과 공유하지 마세요.",
  shareEn: "This link is for you only. Please don't share it.",
  stepsTitle: "설치한 뒤에 (After installing)",
  steps: [
    ["받은 DMG를 열고 Nokka를 응용 프로그램 폴더로 옮긴 뒤 엽니다.", "Open the DMG, move Nokka to Applications and open it."],
    ["Nokka 메뉴에서 ‘업데이트 확인…’을 선택합니다.", "In the Nokka menu, choose ‘업데이트 확인…’ (Check for Updates…)."],
    // A code only when the app asks for one: an installation can take over its registration. Another window
    // may be an update, an error or a failed connection, so it is read, not taken as a registration.
    [
      "등록 화면이 열리면 사용 신청 때 쓴 이메일을 입력하고 ‘코드 받기’를 누른 뒤, 메일로 받은 8자리 코드를 입력하고 ‘등록’을 누릅니다. 다른 창이 열리면 그 창에 표시된 내용을 확인합니다.",
      "If the registration screen opens, enter the email you applied with, press ‘코드 받기’ (Get code), then enter the 8-digit code from the mail and press ‘등록’ (Register). If a different window opens, check what it shows.",
    ],
  ],
  registered: "등록한 Mac은 앱 안에서 다음 업데이트를 받습니다.",
  registeredEn: "Once registered, this Mac receives the next updates in the app.",
};

const kst = (locale: string) =>
  new Intl.DateTimeFormat(locale, {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
const formatKo = kst("ko-KR");
const formatEn = kst("en-US");

function isLink(value: unknown): value is Link {
  if (!value || typeof value !== "object") return false;
  const body = value as Record<string, unknown>;
  return (
    typeof body.ref === "string" &&
    INSTALL_REF_PATTERN.test(body.ref) &&
    typeof body.version === "string" &&
    Number.isInteger(body.build) &&
    Number.isInteger(body.byteLength) &&
    typeof body.expiresAt === "string" &&
    !Number.isNaN(Date.parse(body.expiresAt))
  );
}

const linkOf = ({ ref, version, build, byteLength, expiresAt }: Link): Link => ({ ref, version, build, byteLength, expiresAt });
const isLive = (link: Link) => Date.parse(link.expiresAt) > Date.now();

/** The session answer, or for a used link what the refusal says it opened (when the server tells). */
type Answer = { kind: "opened"; link: Link } | { kind: "used"; link: Link | null } | { kind: "closed" } | { kind: "error" };

/** Sends the token in the body only; the answer sets the download cookie. */
async function openLink(token: string): Promise<Answer> {
  let response: Response;
  try {
    response = await fetch(INSTALL_SESSION_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ token }),
      credentials: "same-origin",
      cache: "no-store",
      referrerPolicy: "no-referrer",
    });
  } catch {
    return { kind: "error" };
  }
  if (response.status === 404) return { kind: "closed" };
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Not the contract (or cut short): read as a failure, or a plain refusal.
  }
  const fields = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (response.status === 410) {
    if (fields.code !== "USED") return { kind: "closed" };
    const link = isLink(fields.link) ? fields.link : isLink(fields) ? fields : null;
    return { kind: "used", link: link && linkOf(link) };
  }
  if (response.status === 200 && fields.ok === true && isLink(fields)) return { kind: "opened", link: linkOf(fields) };
  return { kind: "error" };
}

/** What the token opens, or null when it can not be computed here (not a secure context). */
async function tokenKey(token: string): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

/** What this browser opened with the link `key`, or null (also past its expiry, which is then removed). */
function openedLink(key: string): Link | null {
  try {
    const stored = window.localStorage.getItem(OPENED_PREFIX + key);
    if (stored === null) return null;
    const link: unknown = JSON.parse(stored);
    if (isLink(link) && isLive(link)) return linkOf(link);
    window.localStorage.removeItem(OPENED_PREFIX + key);
  } catch {
    // Unreadable: not opened here.
  }
  return null;
}

/** Keeps (or with null, forgets) what the link `key` opened; other links' keys are only pruned when past expiry. */
function keepOpened(key: string, link: Link | null) {
  try {
    if (link) window.localStorage.setItem(OPENED_PREFIX + key, JSON.stringify(link));
    else window.localStorage.removeItem(OPENED_PREFIX + key);
    for (let index = window.localStorage.length - 1; index >= 0; index--) {
      const name = window.localStorage.key(index);
      if (name?.startsWith(OPENED_PREFIX) && name !== OPENED_PREFIX + key) openedLink(name.slice(OPENED_PREFIX.length));
    }
  } catch {
    // Only opening the same link again here is lost.
  }
}

/** A HEAD of the link's own download address with this browser's cookie; never counted as a download. */
async function probe(link: Link): Promise<"open" | "absent" | "closed" | "failed"> {
  let response: Response;
  try {
    response = await fetch(installDownloadPath(link.ref), {
      method: "HEAD",
      credentials: "same-origin",
      cache: "no-store",
      referrerPolicy: "no-referrer",
    });
  } catch {
    return "failed";
  }
  if (response.status === 200) return "open";
  if (response.status === 404) return "absent";
  if (response.status === 410) return "closed";
  return "failed";
}

/** The download of a link this browser opened before, while its cookie opens it; null if not opened here. */
async function openedBefore(key: string): Promise<State | null> {
  const link = openedLink(key);
  if (!link) return null;
  const found = await probe(link);
  if (found === "open") return { kind: "ready", link };
  if (found === "failed") return { kind: "error" };
  keepOpened(key, null);
  return found === "closed" ? { kind: "closed" } : { kind: "used", key };
}

/**
 * A download shown again (reload, back or forward): its own address with this browser's cookie says whether
 * it still opens. Closed since (410), or the cookie is gone (404, also once a 410 cleared it): no button.
 * Unreachable: what was shown stays, and the download itself says if it is refused.
 */
async function stillOpen(link: Link): Promise<State> {
  const found = await probe(link);
  return found === "closed" || found === "absent" ? { kind: "closed" } : { kind: "ready", link };
}

/**
 * A link's answer. A link opens once: one this browser opened before shows its download without asking
 * again. A used link may still be this browser's: another tab opened it while this one asked, or the first
 * answer was cut short after its cookie arrived; the refusal's link (when the server tells) is then tried.
 */
async function check(token: string): Promise<State> {
  const key = await tokenKey(token);
  const before = key ? await openedBefore(key) : null;
  if (before) return before;
  const answer = await openLink(token);
  if (answer.kind === "opened") {
    if (key) keepOpened(key, answer.link);
    return { kind: "ready", link: answer.link };
  }
  if (answer.kind !== "used") return answer;
  const here = key ? await openedBefore(key) : null;
  if (here) return here;
  if (answer.link && isLive(answer.link)) {
    const found = await probe(answer.link);
    if (found === "open") {
      if (key) keepOpened(key, answer.link);
      return { kind: "ready", link: answer.link };
    }
    if (found === "failed") return { kind: "error" };
    if (found === "closed") return { kind: "closed" };
  }
  return key ? { kind: "used", key } : { kind: "used" };
}

/** The entry's history state with `shown` in place of what it showed (none for null). */
function withShown(shown: Shown | null): Record<string, unknown> {
  const current: unknown = window.history.state;
  const next: Record<string, unknown> = current && typeof current === "object" ? { ...current } : {};
  if (shown) next[SHOWN_STATE] = shown;
  else delete next[SHOWN_STATE];
  return next;
}

/**
 * Keeps a final answer in this entry for a reload, back or forward. In the entry, not the tab's storage: a
 * tab opened from this one copies its storage, never its entries.
 */
function remember(next: State) {
  if (next.kind !== "closed" && next.kind !== "used" && next.kind !== "ready") return;
  try {
    window.history.replaceState(withShown(next), "");
  } catch {
    // A reload then asks for the link again.
  }
}

/** The final answer this entry showed, or null. Past its expiry a download is closed. */
function recall(): Shown | null {
  const current: unknown = window.history.state;
  const value = current && typeof current === "object" ? (current as Record<string, unknown>)[SHOWN_STATE] : null;
  if (!value || typeof value !== "object") return null;
  const shown = value as Record<string, unknown>;
  if (shown.kind === "closed") return { kind: "closed" };
  if (shown.kind === "used") {
    return typeof shown.key === "string" && KEY_PATTERN.test(shown.key) ? { kind: "used", key: shown.key } : { kind: "used" };
  }
  if (shown.kind === "ready" && isLink(shown.link)) {
    return isLive(shown.link) ? { kind: "ready", link: linkOf(shown.link) } : { kind: "closed" };
  }
  return null;
}

/** Sends the token to the page loaded in place of this entry; false when this tab can not. */
function handOver(token: string): boolean {
  try {
    if (window.localStorage.getItem(NO_HANDOVER_KEY) !== null) return false;
    window.sessionStorage.setItem(HANDOVER_KEY, "1");
  } catch {
    return false;
  }
  window.name = HANDOVER_PREFIX + token;
  return true;
}

/** The token the replaced page sent, taken at once; null when none was sent from this tab. */
function takeHandedOver(): string | null {
  const name = window.name;
  const token = name.startsWith(HANDOVER_PREFIX) ? name.slice(HANDOVER_PREFIX.length) : null;
  if (token !== null) window.name = "";
  try {
    if (window.sessionStorage.getItem(HANDOVER_KEY) === null) return null;
    window.sessionStorage.removeItem(HANDOVER_KEY);
    // Sent but not arrived: this browser drops window.name, so later links are checked in place.
    if (token === null) window.localStorage.setItem(NO_HANDOVER_KEY, "1");
  } catch {
    return null;
  }
  return token !== null && INSTALL_TOKEN_PATTERN.test(token) ? token : null;
}

/**
 * /install#<token>. The fragment never leaves the browser in a request. As soon as it is read, it is
 * removed from the address bar and the page loads again in place of its own history entry, the token
 * handed over in memory: Chromium keeps the address a tab opened in that entry, and the new entry does not
 * have it. So the tab's history holds no entry opened with a link, whatever the answer and however many
 * links are opened one after another. The page loaded in its place checks the link once (a link opens
 * once). A failure can be retried with the token in memory. A reload, back or forward shows the entry's last
 * final answer again, a download only once its address still opens with this browser's cookie; while a link
 * is checked it asks for the link again. A used link turns into its
 * download as soon as another tab of this browser keeps it. The download is an ordinary link to that link's
 * own address, so the browser's own download (and its resume) works with that link's cookie.
 */
export default function InstallLinkPage() {
  const [state, setState] = useState<State>({ kind: "checking" });
  const token = useRef<string | null>(null);
  // Only the answer for the link opened last is shown; an earlier one still in flight is dropped.
  const latest = useRef(0);
  // Effects run twice in development; the first fragment is read and removed once.
  const started = useRef(false);

  useEffect(() => {
    /**
     * Checks a link in this document; only the answer for the link opened last is shown and kept. An answer
     * `shown` again is checked once more: a download may have been closed since, and another tab may have
     * kept a used link's download.
     */
    const run = (found: string | null, first: State, shown: Shown | null = null) => {
      token.current = found;
      const request = ++latest.current;
      const show = (next: State) => {
        if (latest.current !== request) return;
        setState(next);
        remember(next);
      };
      void Promise.resolve(first).then(show);
      if (found) void check(found).then(show);
      else if (shown?.kind === "ready") void stillOpen(shown.link).then(show);
      else if (shown?.kind === "used" && shown.key) {
        void openedBefore(shown.key).then((next) => {
          if (next?.kind === "ready") show(next);
        });
      }
    };

    /** Reads the fragment, removes it and its entry, or takes the link the replaced page handed over. */
    const consume = (first: boolean) => {
      const { hash, pathname, search } = window.location;
      // Our own removal changes nothing; a later empty fragment keeps what is shown.
      if (!first && !hash) return;
      if (!hash) {
        const handed = takeHandedOver();
        if (handed) {
          run(handed, { kind: "checking" });
          return;
        }
        // Shown again: a download's button waits until its address answers.
        const shown = recall();
        run(null, shown?.kind === "ready" ? { kind: "checking" } : (shown ?? { kind: "missing" }), shown);
        return;
      }
      const address = pathname + search;
      // The earlier link's answer goes with the fragment: a reload while this one is checked can't offer it.
      window.history.replaceState(withShown(null), "", address);
      const fragment = hash.slice(1);
      const found = INSTALL_TOKEN_PATTERN.test(fragment) ? fragment : null;
      // The previous link's download is gone at once.
      if (!found || handOver(found)) {
        run(null, { kind: "checking" });
        replaceEntry(address);
        return;
      }
      // This tab can not hand the link over: it is checked here, and its entry keeps the address.
      run(found, { kind: "checking" });
    };

    const start = () => {
      if (started.current) return;
      started.current = true;
      consume(true);
    };
    // A page prerendered before the person opened it must not use the link up.
    const prerendering = (document as Document & { prerendering?: boolean }).prerendering === true;
    if (prerendering) document.addEventListener("prerenderingchange", start, { once: true });
    else start();
    const onHashChange = () => consume(false);
    window.addEventListener("hashchange", onHashChange);
    // Shown again from the back-forward cache, where no effect runs: what it shows is checked as on a reload
    // (expired since: closed; a download: no button until its address answers).
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      const shown = recall();
      if (shown) run(null, shown.kind === "ready" ? { kind: "checking" } : shown, shown);
    };
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("prerenderingchange", start);
      window.removeEventListener("hashchange", onHashChange);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  // Another tab of this browser kept the used link's download: show it here too.
  const usedKey = state.kind === "used" ? state.key : undefined;
  useEffect(() => {
    if (!usedKey) return;
    const onStorage = (event: StorageEvent) => {
      if (event.key !== OPENED_PREFIX + usedKey || event.newValue === null) return;
      const request = latest.current;
      void openedBefore(usedKey).then((next) => {
        if (next?.kind !== "ready" || latest.current !== request) return;
        setState(next);
        remember(next);
      });
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [usedKey]);

  async function retry() {
    const current = token.current;
    if (!current) return;
    const request = ++latest.current;
    setState({ kind: "checking" });
    const next = await check(current);
    if (latest.current !== request) return;
    setState(next);
    remember(next);
  }

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-12 md:py-16">
      <h1 className="text-2xl font-semibold text-fg">
        {copy.title}
        <span lang="en" className="mt-1 block text-base font-normal text-fg-muted">
          {copy.titleEn}
        </span>
      </h1>

      <noscript>
        <p className="mt-6 text-fg">{copy.noscript}</p>
        <p lang="en" className="text-sm text-fg-muted">
          {copy.noscriptEn}
        </p>
      </noscript>

      <div role="status" aria-live="polite" className="mt-8">
        {state.kind === "checking" && <Message ko={copy.checking} en={copy.checkingEn} />}
        {state.kind === "missing" && <Message ko={copy.missing} en={copy.missingEn} />}
        {state.kind === "closed" && <Message ko={copy.closed} en={copy.closedEn} />}
        {state.kind === "used" && <Message ko={copy.used} en={copy.usedEn} />}
        {state.kind === "error" && <Message ko={copy.error} en={copy.errorEn} />}
      </div>

      {state.kind === "error" && (
        <button
          type="button"
          onClick={retry}
          className="mt-4 inline-flex h-11 items-center justify-center rounded-full border border-line px-6 text-sm font-medium text-fg transition-colors duration-100 hover:bg-surface-2"
        >
          {copy.retry}
        </button>
      )}

      {state.kind === "ready" && <Ready link={state.link} />}
    </main>
  );
}

function Message({ ko, en }: { ko: string; en: string }) {
  return (
    <>
      <p className="text-fg">{ko}</p>
      <p lang="en" className="mt-1 text-sm text-fg-muted">
        {en}
      </p>
    </>
  );
}

function Ready({ link }: { link: Link }) {
  const until = new Date(link.expiresAt);
  const size = `${(link.byteLength / 1048576).toFixed(1)} MB`;
  return (
    <section className="mt-2 space-y-6">
      <div className="rounded-[14px] border border-line bg-surface p-4 md:p-5">
        <p className="font-medium text-fg">{copy.summary(link.version, link.build, size)}</p>
        <p className="mt-2 text-sm text-fg-muted">{copy.until(`${formatKo.format(until)} (KST)`)}</p>
        <p lang="en" className="mt-1 text-sm text-fg-subtle">
          {copy.untilEn(`${formatEn.format(until)} KST`)}
        </p>
        <a
          href={installDownloadPath(link.ref)}
          download={`Nokka-${link.version}.dmg`}
          className="mt-4 inline-flex h-11 items-center justify-center rounded-full bg-accent-strong px-6 text-sm font-medium text-white transition-colors duration-150 hover:bg-accent-stronger"
        >
          {copy.download}
        </a>
        <p className="mt-4 text-sm text-fg-muted">{copy.share}</p>
        <p lang="en" className="text-sm text-fg-subtle">
          {copy.shareEn}
        </p>
      </div>

      <div>
        <h2 className="text-base font-semibold text-fg">{copy.stepsTitle}</h2>
        <ol className="mt-3 list-decimal space-y-3 pl-5 text-sm text-fg-muted">
          {copy.steps.map(([ko, en]) => (
            <li key={ko}>
              <p className="text-fg">{ko}</p>
              <p lang="en" className="text-fg-subtle">
                {en}
              </p>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-sm text-fg-muted">{copy.registered}</p>
        <p lang="en" className="text-sm text-fg-subtle">
          {copy.registeredEn}
        </p>
      </div>
    </section>
  );
}
