"use client";

import { useEffect, useRef, useState } from "react";
import {
  INSTALL_REF_PATTERN,
  INSTALL_SESSION_ENDPOINT,
  INSTALL_TOKEN_PATTERN,
  installDownloadPath,
  type InstallSessionResult,
} from "@/lib/update-packages/install-contracts";

type State =
  | { kind: "checking" }
  /** No usable token in the fragment (or the page was reloaded after reading it). */
  | { kind: "missing" }
  /** Unknown, expired, revoked or replaced. */
  | { kind: "closed" }
  | { kind: "error" }
  | { kind: "ready"; link: InstallSessionResult };

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
  error: "지금은 링크를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  errorEn: "The link couldn't be checked right now. Please try again in a moment.",
  retry: "다시 시도 (Try again)",
  summary: (version: string, build: number, size: string) => `Nokka ${version} (${build}) · ${size}`,
  until: (date: string) => `${date}까지 받을 수 있습니다. 받는 중에 끊기면 이 기간 안에 다시 받으세요.`,
  untilEn: (date: string) => `You can download it until ${date}. If the download stops, download it again before then.`,
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

function isResult(value: unknown): value is InstallSessionResult {
  if (!value || typeof value !== "object") return false;
  const body = value as Record<string, unknown>;
  return (
    body.ok === true &&
    typeof body.ref === "string" &&
    INSTALL_REF_PATTERN.test(body.ref) &&
    typeof body.version === "string" &&
    Number.isInteger(body.build) &&
    Number.isInteger(body.byteLength) &&
    typeof body.expiresAt === "string" &&
    !Number.isNaN(Date.parse(body.expiresAt))
  );
}

/** Sends the token in the body only; the answer sets the download cookie. */
async function openLink(token: string): Promise<State> {
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
  if (response.status === 404 || response.status === 410) return { kind: "closed" };
  if (response.status === 200) {
    try {
      const body: unknown = await response.json();
      if (isResult(body)) return { kind: "ready", link: body };
    } catch {
      // Not the contract: shown as a failure below.
    }
  }
  return { kind: "error" };
}

/**
 * /install#<token>. The fragment never leaves the browser in a request, and it is removed from the
 * address bar and history as soon as it is read, also when another link is opened in the same tab later
 * (a fragment change does not load the page again). The download is an ordinary link to that link's own
 * address, so the browser's own download (and its resume) works with that link's cookie.
 */
export default function InstallLinkPage() {
  const [state, setState] = useState<State>({ kind: "checking" });
  const token = useRef<string | null>(null);
  // Only the answer for the link opened last is shown; an earlier one still in flight is dropped.
  const latest = useRef(0);
  // Effects run twice in development; the first fragment is read and removed once.
  const started = useRef(false);

  useEffect(() => {
    /** Reads the fragment, removes it, forgets what was shown and checks the link it names. */
    const consume = (first: boolean) => {
      const { hash, pathname, search } = window.location;
      // Our own removal changes nothing; a later empty fragment keeps what is shown.
      if (!first && !hash) return;
      if (hash) window.history.replaceState(window.history.state, "", pathname + search);
      const fragment = hash.slice(1);
      const found = INSTALL_TOKEN_PATTERN.test(fragment) ? fragment : null;
      token.current = found;
      const request = ++latest.current;
      const show = (next: State) => {
        if (latest.current === request) setState(next);
      };
      if (!found) {
        void Promise.resolve<State>({ kind: "missing" }).then(show);
        return;
      }
      // The previous link's download is gone at once, before the new one is checked.
      void Promise.resolve<State>({ kind: "checking" }).then(show);
      void openLink(found).then(show);
    };
    if (!started.current) {
      started.current = true;
      consume(true);
    }
    const onHashChange = () => consume(false);
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  async function retry() {
    const current = token.current;
    if (!current) return;
    const request = ++latest.current;
    setState({ kind: "checking" });
    const next = await openLink(current);
    if (latest.current === request) setState(next);
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

function Ready({ link }: { link: InstallSessionResult }) {
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
