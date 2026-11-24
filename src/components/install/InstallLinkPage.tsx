"use client";

import { useEffect, useRef, useState } from "react";
import {
  INSTALL_BUTTON_ACTION,
  INSTALL_REF_PATTERN,
  INSTALL_SESSION_ENDPOINT,
  INSTALL_TOKEN_PATTERN,
  installDownloadPath,
  type InstallSessionRequest,
  type InstallSessionResult,
} from "@/lib/update-packages/install-contracts";
import { replaceEntry, startDownload } from "./entry";

/** What a link opens: the session answer without `ok`. */
type Link = Omit<InstallSessionResult, "ok">;

type State =
  | { kind: "checking" }
  /** No usable token in the fragment, and nothing to show again in this entry. */
  | { kind: "missing" }
  /** The link is in this document's memory and nothing was sent yet: the button opens it. */
  | { kind: "armed" }
  /** The button was pressed: the link is being opened. */
  | { kind: "opening" }
  /** Shown again (reload, back or forward) before a download: the link is no longer in this document. */
  | { kind: "reopen" }
  /** Unknown, expired, revoked or replaced. */
  | { kind: "closed" }
  /** Used before, and this browser holds no session for it: another browser pressed the button first. */
  | { kind: "used" }
  /** A link that sends its package once, whose one transfer to this browser has started (or that closed since). */
  | { kind: "spent" }
  | { kind: "error" }
  /**
   * Shown again, a link sent once whose download address could not be asked: whether this browser was sent it
   * is not known (a download may have taken it), so nothing says it was not.
   */
  | { kind: "unchecked"; link: Link }
  /**
   * This browser holds the link's session. `requested`: this document asked the browser to download it (the
   * press that opened it, or the button here); shown again, a link sent once has not been sent yet.
   */
  | { kind: "ready"; link: Link; requested: boolean };

/** What an entry keeps for a reload, back or forward. Nothing secret: `armed` is shown again as `reopen`. */
type Shown =
  | Extract<State, { kind: "armed" | "reopen" | "closed" | "used" | "spent" }>
  | { kind: "ready"; link: Link };
const SHOWN_STATE = "nokkaInstall";
// Pages from before the button kept what each opened link showed under the SHA-256 of its token. Nothing
// reads it any more, so it is removed.
const OLD_OPENED_PREFIX = "nokka-install-opened:";
// The token's way from the page that read it to the page loaded in place of its entry: window.name stays
// with the tab across a same-origin load and is never sent or stored by the browser. The marker proves
// this tab sent it; a marker without a token means this browser dropped it, and links are then read in place.
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
  reopen:
    "이 페이지를 다시 불러와 페이지에 설치 링크가 남아 있지 않습니다. 받은 메일의 링크를 다시 열어 주세요. ‘설치 파일 받기’를 누르기 전이었다면 링크는 아직 사용되지 않았습니다.",
  reopenEn:
    "This page was loaded again and no longer has the install link. Open the link from the email again. If you hadn't pressed ‘설치 파일 받기’ (Download), the link hasn't been used.",
  closed: "이 설치 링크는 사용할 수 없습니다. 유효 기간이 지났거나, 회수되었거나, 새 링크로 바뀌었습니다. 새 링크가 필요합니다.",
  closedEn: "This install link can't be used: it has expired, was revoked or was replaced by a newer one. You need a new link.",
  used: "이 설치 링크는 이미 사용되었습니다. 링크는 한 번만 쓸 수 있어, ‘설치 파일 받기’를 처음 누른 브라우저에서만 받을 수 있습니다. 그 브라우저에서 받은 파일이 없거나 받는 중에 끊겼다면 새 링크가 필요하니, 안내 메일에 회신해 주세요.",
  usedEn:
    "This install link was already used. A link works once, so only the browser where ‘설치 파일 받기’ (Download) was first pressed can download. If you don't have the file from that browser or its download stopped, you need a new link: reply to the email you got it from.",
  spent:
    "이 링크로는 더 받을 수 없습니다. 이 브라우저에서 이미 설치 파일을 받기 시작했거나, 그 사이 링크가 마감되었습니다. 받은 파일은 브라우저의 다운로드 목록에서 확인하세요. 받은 파일이 없거나 받는 중에 끊겼다면 새 링크가 필요하니, 안내 메일에 회신해 주세요.",
  spentEn:
    "This link can't download any more: this browser already started downloading the installer, or the link has closed since. Check your browser's downloads for the file. If you don't have it or the download stopped, you need a new link: reply to the email you got it from.",
  unchecked:
    "이 브라우저로 설치 파일을 받았는지 지금은 확인하지 못했습니다. 잠시 후 다시 확인해 주세요. 받은 파일은 브라우저의 다운로드 목록에서도 확인할 수 있습니다.",
  uncheckedEn:
    "We couldn't check right now whether this browser already downloaded the installer. Please check again in a moment; you can also look for the file in your browser's downloads.",
  recheck: "다시 확인 (Check again)",
  error: "지금은 링크를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  errorEn: "The link couldn't be checked right now. Please try again in a moment.",
  retry: "다시 시도 (Try again)",
  armed: "설치할 Mac에서 아래 버튼을 누르면 설치 파일을 받기 시작합니다.",
  armedEn: "On the Mac you'll install Nokka on, press the button below to download the installer.",
  once: "이 링크로는 설치 파일을 한 번만 받을 수 있습니다. 링크는 버튼을 누를 때 사용되고, 이 페이지를 열기만 해서는 사용되지 않습니다. 받는 중에 끊기면 새 링크가 필요하니, 안내 메일에 회신해 주세요.",
  onceEn:
    "This link downloads the installer once. It is used when you press the button, not when this page opens. If the download stops, you need a new link: reply to the email you got it from.",
  summary: (version: string, build: number, size: string) => `Nokka ${version} (${build}) · ${size}`,
  requested: "브라우저에 설치 파일 받기를 요청했습니다. 브라우저의 다운로드 목록에서 받는 중인지 확인하세요.",
  requestedEn: "Your browser was asked to download the installer. Check your browser's downloads to see it coming in.",
  waiting: "이 브라우저로 아직 설치 파일을 받지 않았습니다. 아래 버튼을 누르면 받기 시작합니다.",
  waitingEn: "The installer hasn't been downloaded to this browser yet. Press the button below to start.",
  startedOnce:
    "이 링크로는 한 번만 받을 수 있어, 받는 중에 끊겼다면 이 링크로 다시 받을 수 없습니다. 그때는 안내 메일에 회신해 새 링크를 받아 주세요.",
  startedOnceEn:
    "This link downloads only once: if the download stopped, it can't be downloaded again with this link. Reply to the email you got it from for a new link.",
  until: (date: string) =>
    `${date}까지 받을 수 있습니다. 받는 중에 끊기면 이 기간 안에 이 브라우저에서 다시 받으세요. 받은 링크를 다시 열고 ‘설치 파일 받기’를 눌러도 됩니다.`,
  untilEn: (date: string) =>
    `You can download it until ${date}. If the download stops, download it again in this browser before then; you can also open the link again and press ‘설치 파일 받기’ (Download).`,
  download: "설치 파일 받기 (Download)",
  notStarted: "받기가 시작되지 않았다면 여기를 누르세요 (Start the download)",
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

// Entries kept by pages from before the button have no `singleTransfer`: those links download until they close.
const linkOf = ({ ref, version, build, byteLength, expiresAt, singleTransfer }: Link): Link => ({
  ref,
  version,
  build,
  byteLength,
  expiresAt,
  singleTransfer: singleTransfer === true,
});
const isLive = (link: Link) => Date.parse(link.expiresAt) > Date.now();
const fileName = (link: Link) => `Nokka-${link.version}.dmg`;

/** The session answer, or for a used link what the refusal says it opened (when the server tells). */
type Answer = { kind: "opened"; link: Link } | { kind: "used"; link: Link | null } | { kind: "closed" } | { kind: "error" };

/** Sends the token in the body only, as the button's request; the answer sets the download cookie. */
async function openLink(token: string): Promise<Answer> {
  const request: InstallSessionRequest = { token, action: INSTALL_BUTTON_ACTION };
  let response: Response;
  try {
    response = await fetch(INSTALL_SESSION_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(request),
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

type Probe = "open" | "absent" | "closed" | "failed";

/** A HEAD of the link's own download address with this browser's cookie: it never takes or counts a download. */
async function probe(link: Link): Promise<Probe> {
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

/**
 * What a link this browser may hold the session of shows, by its download address's answer. 410 is a closed
 * link, or one that sends its package once and whose transfer has started; `absent` (404: no session here) and
 * `failed` are the caller's.
 */
function held(link: Link, found: Probe, absent: State, failed: State): State {
  if (found === "open") return { kind: "ready", link, requested: false };
  if (found === "absent") return absent;
  if (found === "failed") return failed;
  return link.singleTransfer ? { kind: "spent" } : { kind: "closed" };
}

/**
 * What pressing the button gets. A link opens once: a used link may still be this browser's (another tab
 * pressed first, or the first answer was cut short after its cookie arrived), and the refusal's link (when the
 * server tells) is then tried with this browser's cookie.
 */
async function take(token: string): Promise<State> {
  const answer = await openLink(token);
  if (answer.kind === "opened") return { kind: "ready", link: answer.link, requested: false };
  if (answer.kind !== "used") return answer;
  if (!answer.link || !isLive(answer.link)) return { kind: "used" };
  return held(answer.link, await probe(answer.link), { kind: "used" }, { kind: "error" });
}

/**
 * A download shown again (reload, back or forward): its own address with this browser's cookie says whether
 * it still opens. The cookie is gone (404) once a refusal cleared it: a link that sends once has then sent.
 * Unreachable: a link sent once is shown as not known (it may have been sent), to be checked again; another
 * link keeps its download, and the download itself says if it is refused.
 */
async function stillOpen(link: Link): Promise<State> {
  const gone: State = link.singleTransfer ? { kind: "spent" } : { kind: "closed" };
  const unknown: State = link.singleTransfer ? { kind: "unchecked", link } : { kind: "ready", link, requested: false };
  return held(link, await probe(link), gone, unknown);
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
 * Keeps what is shown in this entry for a reload, back or forward. In the entry, not the tab's storage: a tab
 * opened from this one copies its storage, never its entries.
 */
function remember(next: State) {
  // Not final (`unchecked` included): the entry keeps what it showed before, so the next reload asks again.
  if (
    next.kind === "checking" ||
    next.kind === "missing" ||
    next.kind === "opening" ||
    next.kind === "error" ||
    next.kind === "unchecked"
  ) {
    return;
  }
  const shown: Shown = next.kind === "ready" ? { kind: "ready", link: next.link } : next;
  try {
    window.history.replaceState(withShown(shown), "");
  } catch {
    // A reload then asks to reopen the link.
  }
}

/** What this entry showed, or null. Past its expiry a download is closed; the button is gone with the link. */
function recall(): Shown | null {
  const current: unknown = window.history.state;
  const value = current && typeof current === "object" ? (current as Record<string, unknown>)[SHOWN_STATE] : null;
  if (!value || typeof value !== "object") return null;
  const shown = value as Record<string, unknown>;
  if (shown.kind === "closed" || shown.kind === "used" || shown.kind === "spent") return { kind: shown.kind };
  if (shown.kind === "armed" || shown.kind === "reopen") return { kind: "reopen" };
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
    // Sent but not arrived: this browser drops window.name, so later links are read in place.
    if (token === null) window.localStorage.setItem(NO_HANDOVER_KEY, "1");
  } catch {
    return null;
  }
  return token !== null && INSTALL_TOKEN_PATTERN.test(token) ? token : null;
}

/** Removes what pages from before the button kept for each link they opened. */
function forgetOpened() {
  try {
    for (let index = window.localStorage.length - 1; index >= 0; index--) {
      const name = window.localStorage.key(index);
      if (name?.startsWith(OLD_OPENED_PREFIX)) window.localStorage.removeItem(name);
    }
  } catch {
    // Unreadable storage keeps nothing readable either.
  }
}

/**
 * /install#<token>. The fragment never leaves the browser in a request. As soon as it is read, it is removed
 * from the address bar and the page loads again in place of its own history entry, the token handed over in
 * memory: Chromium keeps the address a tab opened in that entry, and the new entry does not have it. So the
 * tab's history holds no entry opened with a link.
 *
 * Loading the page sends nothing: a link is used only by the ‘설치 파일 받기’ button, which opens it (once; the
 * request says it comes from the button) and starts the download of the link's own address with the cookie
 * that answer set. Opening, reloading or previewing the page, also in a mail scanner that runs it, leaves the
 * link unused. A failure can be pressed again with the token in memory. A reload, back or forward shows what
 * the entry last showed: before the button, a request to reopen the link from the mail (the token is gone with
 * the document); a download only once its address still opens with this browser's cookie, never starting it
 * again by itself.
 */
export default function InstallLinkPage() {
  const [state, setState] = useState<State>({ kind: "checking" });
  // The link's token while it can still be pressed (or pressed again after a failure); never stored.
  const token = useRef<string | null>(null);
  // Only the answer for the link read last is shown; an earlier one still in flight is dropped.
  const latest = useRef(0);
  // Effects run twice in development; the first fragment is read and removed once.
  const started = useRef(false);

  useEffect(() => {
    /** Shows `first` for the link `found` (or none); a download `shown` again is checked once more. */
    const run = (found: string | null, first: State, shown: Shown | null = null) => {
      token.current = found;
      const request = ++latest.current;
      const show = (next: State) => {
        if (latest.current !== request) return;
        setState(next);
        remember(next);
      };
      void Promise.resolve(first).then(show);
      if (shown?.kind === "ready") void stillOpen(shown.link).then(show);
    };

    /** Reads the fragment, removes it and its entry, or takes the link the replaced page handed over. */
    const consume = (first: boolean) => {
      const { hash, pathname, search } = window.location;
      // Our own removal changes nothing; a later empty fragment keeps what is shown.
      if (!first && !hash) return;
      if (!hash) {
        const handed = takeHandedOver();
        if (handed) {
          run(handed, { kind: "armed" });
          return;
        }
        // Shown again: a download's button waits until its address answers.
        const shown = recall();
        run(null, shown?.kind === "ready" ? { kind: "checking" } : (shown ?? { kind: "missing" }), shown);
        return;
      }
      const address = pathname + search;
      // The earlier link's answer goes with the fragment: a reload can't offer it for this one.
      window.history.replaceState(withShown(null), "", address);
      const fragment = hash.slice(1);
      const found = INSTALL_TOKEN_PATTERN.test(fragment) ? fragment : null;
      // The previous link's download is gone at once.
      if (!found || handOver(found)) {
        run(null, { kind: "checking" });
        replaceEntry(address);
        return;
      }
      // This tab can not hand the link over: it waits for the button here, and its entry keeps the address.
      run(found, { kind: "armed" });
    };

    const start = () => {
      if (started.current) return;
      started.current = true;
      forgetOpened();
      consume(true);
    };
    // A page prerendered before the person opened it reads nothing yet.
    const prerendering = (document as Document & { prerendering?: boolean }).prerendering === true;
    if (prerendering) document.addEventListener("prerenderingchange", start, { once: true });
    else start();
    const onHashChange = () => consume(false);
    window.addEventListener("hashchange", onHashChange);
    // Shown again from the back-forward cache, where no effect runs. A link still in memory keeps its button;
    // otherwise what it shows is checked as on a reload (expired since: closed; a download: no button until
    // its address answers).
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted || token.current) return;
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

  async function press() {
    const current = token.current;
    if (!current) return;
    // Out of reach while it is opened: a second press can not send it again at the same time.
    token.current = null;
    const request = ++latest.current;
    setState({ kind: "opening" });
    const next = await take(current);
    if (latest.current !== request) return;
    // Kept only to press again after a failure; every other answer is final for this link.
    if (next.kind === "error") token.current = current;
    remember(next);
    if (next.kind === "ready") download(next.link);
    else setState(next);
  }

  /** Asks again whether a download shown again is still this browser's (a HEAD; it takes nothing). */
  async function recheck(link: Link) {
    const request = ++latest.current;
    setState({ kind: "checking" });
    const next = await stillOpen(link);
    if (latest.current !== request) return;
    setState(next);
    remember(next);
  }

  /** Asks the browser to download the link this browser holds; in a click, also the person's own. */
  function download(link: Link) {
    startDownload(installDownloadPath(link.ref), fileName(link));
    setState({ kind: "ready", link, requested: true });
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
        {(state.kind === "checking" || state.kind === "opening") && <Message ko={copy.checking} en={copy.checkingEn} />}
        {state.kind === "missing" && <Message ko={copy.missing} en={copy.missingEn} />}
        {state.kind === "reopen" && <Message ko={copy.reopen} en={copy.reopenEn} />}
        {state.kind === "closed" && <Message ko={copy.closed} en={copy.closedEn} />}
        {state.kind === "used" && <Message ko={copy.used} en={copy.usedEn} />}
        {state.kind === "spent" && <Message ko={copy.spent} en={copy.spentEn} />}
        {state.kind === "error" && <Message ko={copy.error} en={copy.errorEn} />}
        {state.kind === "unchecked" && <Message ko={copy.unchecked} en={copy.uncheckedEn} />}
      </div>

      {state.kind === "error" && (
        <button
          type="button"
          onClick={press}
          className="mt-4 inline-flex h-11 items-center justify-center rounded-full border border-line px-6 text-sm font-medium text-fg transition-colors duration-100 hover:bg-surface-2"
        >
          {copy.retry}
        </button>
      )}

      {state.kind === "unchecked" && (
        <button
          type="button"
          onClick={() => recheck(state.link)}
          className="mt-4 inline-flex h-11 items-center justify-center rounded-full border border-line px-6 text-sm font-medium text-fg transition-colors duration-100 hover:bg-surface-2"
        >
          {copy.recheck}
        </button>
      )}

      {(state.kind === "armed" || state.kind === "opening") && <Armed busy={state.kind === "opening"} onPress={press} />}
      {state.kind === "ready" && <Ready link={state.link} requested={state.requested} onDownload={() => download(state.link)} />}
      {(state.kind === "armed" ||
        state.kind === "opening" ||
        state.kind === "ready" ||
        state.kind === "spent" ||
        state.kind === "unchecked") && <Steps />}
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

const primary =
  "mt-4 inline-flex h-11 items-center justify-center rounded-full bg-accent-strong px-6 text-sm font-medium text-white transition-colors duration-150 hover:bg-accent-stronger";

function Armed({ busy, onPress }: { busy: boolean; onPress: () => void }) {
  return (
    <section className="mt-2 rounded-[14px] border border-line bg-surface p-4 md:p-5">
      <p className="font-medium text-fg">{copy.armed}</p>
      <p lang="en" className="mt-1 text-sm text-fg-muted">
        {copy.armedEn}
      </p>
      <p className="mt-3 text-sm text-fg-muted">{copy.once}</p>
      <p lang="en" className="mt-1 text-sm text-fg-subtle">
        {copy.onceEn}
      </p>
      <button type="button" onClick={onPress} disabled={busy} className={`${primary} disabled:opacity-60`}>
        {copy.download}
      </button>
      <p className="mt-4 text-sm text-fg-muted">{copy.share}</p>
      <p lang="en" className="text-sm text-fg-subtle">
        {copy.shareEn}
      </p>
    </section>
  );
}

function Ready({ link, requested, onDownload }: { link: Link; requested: boolean; onDownload: () => void }) {
  const until = new Date(link.expiresAt);
  const size = `${(link.byteLength / 1048576).toFixed(1)} MB`;
  if (!link.singleTransfer) {
    return (
      <section className="mt-2 rounded-[14px] border border-line bg-surface p-4 md:p-5">
        <p className="font-medium text-fg">{copy.summary(link.version, link.build, size)}</p>
        <p className="mt-2 text-sm text-fg-muted">{copy.until(`${formatKo.format(until)} (KST)`)}</p>
        <p lang="en" className="mt-1 text-sm text-fg-subtle">
          {copy.untilEn(`${formatEn.format(until)} KST`)}
        </p>
        {/* An ordinary download link: the browser's own download and resume work with the link's cookie. */}
        <a href={installDownloadPath(link.ref)} download={fileName(link)} className={primary}>
          {copy.download}
        </a>
      </section>
    );
  }
  return (
    <section className="mt-2 rounded-[14px] border border-line bg-surface p-4 md:p-5">
      <p className="font-medium text-fg">{copy.summary(link.version, link.build, size)}</p>
      <p className="mt-2 text-sm text-fg">{requested ? copy.requested : copy.waiting}</p>
      <p lang="en" className="mt-1 text-sm text-fg-muted">
        {requested ? copy.requestedEn : copy.waitingEn}
      </p>
      <p className="mt-2 text-sm text-fg-muted">{copy.startedOnce}</p>
      <p lang="en" className="mt-1 text-sm text-fg-subtle">
        {copy.startedOnceEn}
      </p>
      {requested ? (
        // An ordinary download link: a click is the person's own, whatever the browser allowed the press.
        <a href={installDownloadPath(link.ref)} download={fileName(link)} className={primary}>
          {copy.notStarted}
        </a>
      ) : (
        <button type="button" onClick={onDownload} className={primary}>
          {copy.download}
        </button>
      )}
    </section>
  );
}

function Steps() {
  return (
    <section className="mt-6">
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
    </section>
  );
}
