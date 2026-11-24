import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { replaceEntry } from "../entry";
import InstallLinkPage from "../InstallLinkPage";

// jsdom loads no documents: the page's load in place of its entry is recorded, and `arrive` plays it.
vi.mock("../entry", () => ({ replaceEntry: vi.fn() }));

// Synthetic link secrets (43 base64url characters) and refs for tests only.
const TOKEN = "s".repeat(42) + "A";
const TOKEN_2 = "n".repeat(42) + "A";
const TOKEN_REVOKED = "r".repeat(42) + "A";
const REF = "5a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const REF_2 = "6a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
// What a link opens, and the session answer that says so.
const LINK = { ref: REF, version: "2.7.0", build: 24, byteLength: 34_863_922, expiresAt: "2026-11-26T03:30:00.000Z" };
const READY = { ok: true, ...LINK };
const READY_2 = { ...READY, ref: REF_2, version: "2.7.1", build: 25 };
const DOWNLOAD = "설치 파일 받기 (Download)";
const SESSION = "/api/updates/v1/install/session";
const CLOSED = /이 설치 링크는 사용할 수 없습니다/;
const USED = /이 설치 링크는 이미 열렸습니다/;
const USED_ANSWER = { ok: false, code: "USED" };
const MISSING = "링크 주소가 완전하지 않습니다. 받은 링크를 그대로 다시 열어 주세요.";
const ERROR = /지금은 링크를 확인하지 못했습니다/;

function reply(status: number, body: unknown = null) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

let fetchMock: ReturnType<typeof vi.fn>;
let view: ReturnType<typeof render> | null = null;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.mocked(replaceEntry).mockReset();
  // Before READY expires, whenever the tests run; timers stay real.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-25T00:00:00.000Z"));
});
afterEach(() => {
  view?.unmount();
  view = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
  window.sessionStorage.clear();
  window.localStorage.clear();
  window.name = "";
});

function mount() {
  view = render(
    <StrictMode>
      <InstallLinkPage />
    </StrictMode>,
  );
  return view;
}

/** The page opened at `address`. */
function open(address: string) {
  view?.unmount();
  window.history.replaceState(null, "", address);
  return mount();
}

/** The browser loads the page the last `replaceEntry` asked for, in the same tab (window.name kept). */
function arrive() {
  const calls = vi.mocked(replaceEntry).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return open(calls[calls.length - 1][0]);
}

/** The person reloads the tab: the same entry, its history state kept. */
function reload() {
  view?.unmount();
  return mount();
}

/** Another tab of the same browser: its own entries, session storage and name; the browser's local storage. */
function newTab() {
  view?.unmount();
  view = null;
  window.history.replaceState(null, "", "/");
  window.sessionStorage.clear();
  window.name = "";
}

/** What this browser keeps for the link `token`. */
async function openedKey(token: string) {
  return `nokka-install-opened:${await sha256(token)}`;
}

/** Another tab of this browser keeps what `token` opened, as its storage event reaches this tab. */
async function keptByAnotherTab(token: string, link: unknown) {
  const key = await openedKey(token);
  const value = JSON.stringify(link);
  window.localStorage.setItem(key, value);
  act(() => {
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: value }));
  });
}

/** Another link opened in the same tab: a fragment change, then the page leaves that entry. */
async function openInTab(fragment: string) {
  const before = vi.mocked(replaceEntry).mock.calls.length;
  act(() => {
    window.location.hash = fragment;
  });
  await waitFor(() => expect(replaceEntry).toHaveBeenCalledTimes(before + 1));
}

/** Opens a link and lets the page loaded in place of its entry check it. */
async function openAndArrive(address: string) {
  open(address);
  expect(replaceEntry).toHaveBeenLastCalledWith(address.split("#")[0]);
  return arrive();
}

/** Everything this tab and browser store, to check that no secret is in it. */
function stored() {
  const all = [window.sessionStorage, window.localStorage].flatMap((storage) =>
    Object.keys(storage).map((key) => `${key}=${storage.getItem(key)}`),
  );
  return `${all.join("\n")}\nname=${window.name}\nstate=${JSON.stringify(window.history.state)}`;
}

/** Makes this tab unable to store anything. */
function blockStorage() {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("blocked", "SecurityError");
  });
}

describe("InstallLinkPage", () => {
  it("hands the secret over without its entry, then sends it once in a POST body", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, READY));
    open(`/install?from=mail#${TOKEN}`);
    // Read, removed from the address, and the page loads again in place of the entry before any request.
    expect(window.location.hash).toBe("");
    expect(window.location.pathname + window.location.search).toBe("/install?from=mail");
    expect(replaceEntry).toHaveBeenCalledTimes(1);
    expect(replaceEntry).toHaveBeenCalledWith("/install?from=mail");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText("링크를 확인하는 중…")).toBeInTheDocument();

    arrive();
    expect(await screen.findByRole("link", { name: DOWNLOAD })).toBeInTheDocument();
    // Once, even though development effects run twice.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(SESSION);
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin", cache: "no-store", referrerPolicy: "no-referrer" });
    expect(JSON.parse(init.body)).toEqual({ token: TOKEN });
    // Taken at once; nothing kept holds the secret.
    expect(window.name).toBe("");
    expect(stored()).not.toContain(TOKEN);
    expect(replaceEntry).toHaveBeenCalledTimes(1);
  });

  it("offers an ordinary link to the fixed download address, with what it serves and until when", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, READY));
    await openAndArrive(`/install#${TOKEN}`);
    const download = await screen.findByRole("link", { name: DOWNLOAD });
    expect(download).toHaveAttribute("href", `/api/updates/v1/install/${REF}/Nokka.dmg`);
    expect(download).toHaveAttribute("download", "Nokka-2.7.0.dmg");
    expect(screen.getByText("Nokka 2.7.0 (24) · 33.2 MB")).toBeInTheDocument();
    expect(screen.getByText(/2026\. 11\. 26\. 12:30 \(KST\)까지 받을 수 있습니다/)).toBeInTheDocument();
    expect(screen.getByText(/until 11\/26\/2026, 12:30 KST/)).toBeInTheDocument();
    // A link opens once: downloading again happens in this browser.
    expect(screen.getByText(/처음 연 브라우저에서만 쓸 수 있으니/)).toBeInTheDocument();
    expect(screen.getByText(/works only in the browser that opened it first/)).toBeInTheDocument();
    expect(screen.getByText(/‘업데이트 확인…’을 선택합니다/)).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(TOKEN);
  });

  it("asks for a code after installing only when the registration screen opens", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, READY));
    await openAndArrive(`/install#${TOKEN}`);
    await screen.findByRole("link", { name: DOWNLOAD });
    const steps = screen.getAllByRole("listitem");
    const code = steps.filter((step) => step.textContent!.includes("8자리 코드"));
    expect(code).toHaveLength(1);
    expect(code[0]).toHaveTextContent(/^등록 화면이 열리면 .*다른 창이 열리면 그 창에 표시된 내용을 확인합니다\./);
    expect(code[0]).toHaveTextContent(/If the registration screen opens, .*If a different window opens, check what it shows\.$/);
    // Another window can be an error or a failed connection: nothing claims the Mac is registered.
    expect(document.body).not.toHaveTextContent(/이미 등록|already registered/);
  });

  it("asks to reopen the link without a fragment, without a request or a new entry", async () => {
    open("/install");
    expect(await screen.findByText(MISSING)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(replaceEntry).not.toHaveBeenCalled();
  });

  it.each([
    ["a malformed fragment", "/install#abc"],
    ["a cut fragment", `/install#${TOKEN.slice(0, 40)}`],
    ["a padded fragment", `/install#${"s".repeat(42)}=`],
  ])("leaves the entry of %s too, and asks to reopen the link without a request", async (_, address) => {
    open(address);
    expect(window.location.hash).toBe("");
    expect(window.name).toBe("");
    arrive();
    expect(await screen.findByText(MISSING)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(stored()).not.toContain(TOKEN.slice(0, 40));
  });

  it.each([
    [404, "NOT_FOUND"],
    [410, "GONE"],
    [410, undefined],
  ])("says the link can not be used when the server answers %i %s", async (status, code) => {
    fetchMock.mockResolvedValueOnce(reply(status, code ? { ok: false, code } : null));
    await openAndArrive(`/install#${TOKEN}`);
    expect(await screen.findByText(CLOSED)).toBeInTheDocument();
    expect(screen.getByText(/유효 기간이 지났거나, 회수되었거나, 새 링크로 바뀌었습니다/)).toBeInTheDocument();
    expect(screen.queryByText(USED)).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("says the link was opened before, and only that browser can download, when it is used", async () => {
    fetchMock.mockResolvedValueOnce(reply(410, USED_ANSWER));
    await openAndArrive(`/install#${TOKEN}`);
    expect(await screen.findByText(USED)).toBeInTheDocument();
    expect(screen.getByText(/처음 연 브라우저에서만 받을 수 있습니다/)).toBeInTheDocument();
    expect(screen.getByText(/only the browser that opened it first can download/)).toBeInTheDocument();
    expect(screen.queryByText(CLOSED)).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("lets the person retry a failure with the link in memory, then shows the download", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(reply(503, { ok: false, code: "UNAVAILABLE" }))
      .mockResolvedValueOnce(reply(200, { ...READY, ref: "not-a-ref" }))
      .mockResolvedValueOnce(reply(200, READY));
    await openAndArrive(`/install#${TOKEN}`);
    for (let attempt = 0; attempt < 3; attempt++) {
      expect(await screen.findByText(ERROR)).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "다시 시도 (Try again)" }));
    }
    expect(await screen.findByRole("link", { name: DOWNLOAD })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    for (const [, init] of fetchMock.mock.calls) expect(JSON.parse(init.body)).toEqual({ token: TOKEN });
    // The entry was left before the first request, failures included.
    expect(replaceEntry).toHaveBeenCalledTimes(1);
  });

  describe("an answer cut short after the link was used", () => {
    const cut = () => ({ ok: true, status: 200, json: async () => Promise.reject(new TypeError("body cut short")) });

    it.each([
      ["inside `link`", { ...USED_ANSWER, link: LINK }],
      ["as its fields", { ...USED_ANSWER, ...LINK }],
    ])("recovers the download on retry when the refusal names the link %s and its cookie opens it", async (_, used) => {
      const user = userEvent.setup();
      fetchMock.mockResolvedValueOnce(cut()).mockResolvedValueOnce(reply(410, used)).mockResolvedValueOnce(reply(200));
      await openAndArrive(`/install#${TOKEN}`);
      await user.click(await screen.findByRole("button", { name: "다시 시도 (Try again)" }));
      expect(await screen.findByRole("link", { name: DOWNLOAD })).toHaveAttribute("href", `/api/updates/v1/install/${REF}/Nokka.dmg`);
      expect(fetchMock.mock.calls.map(([url, init]) => `${init.method} ${url}`)).toEqual([
        `POST ${SESSION}`,
        `POST ${SESSION}`,
        `HEAD /api/updates/v1/install/${REF}/Nokka.dmg`,
      ]);
      // Kept for this browser: opening the link again shows it without asking.
      expect(window.localStorage.getItem(await openedKey(TOKEN))).toBe(JSON.stringify(LINK));
    });

    it.each([
      [404, USED],
      [410, CLOSED],
    ])("says so when the refusal names the link but its address answers %i", async (status, text) => {
      const user = userEvent.setup();
      fetchMock.mockResolvedValueOnce(cut()).mockResolvedValueOnce(reply(410, { ...USED_ANSWER, link: LINK })).mockResolvedValueOnce(reply(status));
      await openAndArrive(`/install#${TOKEN}`);
      await user.click(await screen.findByRole("button", { name: "다시 시도 (Try again)" }));
      expect(await screen.findByText(text)).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: DOWNLOAD })).not.toBeInTheDocument();
      expect(window.localStorage.getItem(await openedKey(TOKEN))).toBeNull();
    });

    it("says the link was used when the refusal does not name it", async () => {
      const user = userEvent.setup();
      fetchMock.mockRejectedValueOnce(new TypeError("connection lost")).mockResolvedValueOnce(reply(410, USED_ANSWER));
      await openAndArrive(`/install#${TOKEN}`);
      await user.click(await screen.findByRole("button", { name: "다시 시도 (Try again)" }));
      expect(await screen.findByText(USED)).toBeInTheDocument();
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  it("checks a link opened later in the same tab in a new entry, the previous download gone first", async () => {
    let answer2!: (value: unknown) => void;
    fetchMock
      .mockResolvedValueOnce(reply(200, READY))
      .mockReturnValueOnce(new Promise((resolve) => (answer2 = resolve)))
      .mockResolvedValueOnce(reply(410, { ok: false, code: "GONE" }));
    await openAndArrive(`/install#${TOKEN}`);
    expect(await screen.findByRole("link", { name: DOWNLOAD })).toHaveAttribute("href", `/api/updates/v1/install/${REF}/Nokka.dmg`);

    // Another link, same document: a fragment change. Its entry is left before it is checked.
    await openInTab(TOKEN_2);
    expect(window.location.hash).toBe("");
    expect(screen.queryByRole("link", { name: DOWNLOAD })).not.toBeInTheDocument();
    expect(screen.getByText("링크를 확인하는 중…")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    arrive();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ token: TOKEN_2 });
    await act(async () => answer2(reply(200, READY_2)));
    expect(await screen.findByRole("link", { name: DOWNLOAD })).toHaveAttribute("href", `/api/updates/v1/install/${REF_2}/Nokka.dmg`);
    expect(screen.getByText(/Nokka 2\.7\.1 \(25\)/)).toBeInTheDocument();

    // A revoked link's fragment: the shown download is replaced by the refusal.
    await openInTab(TOKEN_REVOKED);
    arrive();
    expect(await screen.findByText(CLOSED)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: DOWNLOAD })).not.toBeInTheDocument();

    // A malformed fragment: asked to reopen, without a request.
    await openInTab("abc");
    arrive();
    expect(await screen.findByText(MISSING)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(replaceEntry).toHaveBeenCalledTimes(4);
    expect(document.body.innerHTML).not.toContain(TOKEN_2);
  });

  it("leaves each link's entry when a second link is opened while the first is still checked", async () => {
    let answer1!: (value: unknown) => void;
    fetchMock.mockReturnValueOnce(new Promise((resolve) => (answer1 = resolve))).mockResolvedValueOnce(reply(200, READY_2));
    await openAndArrive(`/install#${TOKEN}`);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    // Each link's entry was left before its request: the first one's when it was read.
    expect(replaceEntry).toHaveBeenCalledTimes(1);

    await openInTab(TOKEN_2);
    expect(replaceEntry).toHaveBeenCalledTimes(2);
    expect(window.name).toBe(`nokka-install:${TOKEN_2}`);
    await act(async () => answer1(reply(200, READY)));
    // The first answer is not shown or kept for a reload.
    expect(screen.queryByRole("link", { name: DOWNLOAD })).not.toBeInTheDocument();
    expect(window.sessionStorage.getItem("nokka-install-shown")).toBeNull();

    arrive();
    expect(await screen.findByRole("link", { name: DOWNLOAD })).toHaveAttribute("href", `/api/updates/v1/install/${REF_2}/Nokka.dmg`);
    expect(screen.getAllByRole("link", { name: DOWNLOAD })).toHaveLength(1);
  });

  describe("a reload", () => {
    it.each([
      ["a refusal", reply(410, { ok: false, code: "GONE" }), () => screen.findByText(CLOSED)],
      ["a used link", reply(410, USED_ANSWER), () => screen.findByText(USED)],
    ])("shows %s again without asking", async (_, answer, find) => {
      fetchMock.mockResolvedValueOnce(answer);
      await openAndArrive(`/install#${TOKEN}`);
      await find();
      reload();
      expect(await find()).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(replaceEntry).toHaveBeenCalledTimes(1);
    });

    it("offers the download again only once its address still opens with this browser's cookie", async () => {
      let opens!: (value: unknown) => void;
      fetchMock.mockResolvedValueOnce(reply(200, READY)).mockReturnValueOnce(new Promise((resolve) => (opens = resolve)));
      await openAndArrive(`/install#${TOKEN}`);
      await screen.findByRole("link", { name: DOWNLOAD });
      reload();
      // No button while its address is asked.
      expect(await screen.findByText("링크를 확인하는 중…")).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: DOWNLOAD })).not.toBeInTheDocument();
      const [url, init] = fetchMock.mock.calls[1];
      expect(url).toBe(`/api/updates/v1/install/${REF}/Nokka.dmg`);
      expect(init).toMatchObject({ method: "HEAD", credentials: "same-origin", cache: "no-store", referrerPolicy: "no-referrer" });
      await act(async () => opens(reply(200)));
      expect(await screen.findByRole("link", { name: DOWNLOAD })).toHaveAttribute("href", `/api/updates/v1/install/${REF}/Nokka.dmg`);
      // The link itself is never sent again.
      expect(fetchMock.mock.calls.map(([, init]) => init.method)).toEqual(["POST", "HEAD"]);
      expect(replaceEntry).toHaveBeenCalledTimes(1);
    });

    it.each([
      [410, "revoked, replaced or expired since"],
      [404, "without its cookie in this browser any more"],
    ])("says a download can not be used when its address answers %i (%s), and keeps saying so", async (status) => {
      fetchMock.mockResolvedValueOnce(reply(200, READY)).mockResolvedValueOnce(reply(status));
      await openAndArrive(`/install#${TOKEN}`);
      await screen.findByRole("link", { name: DOWNLOAD });
      reload();
      expect(await screen.findByText(CLOSED)).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: DOWNLOAD })).not.toBeInTheDocument();
      expect(window.history.state).toMatchObject({ nokkaInstall: { kind: "closed" } });

      // Kept in the entry: the next reload says so without asking again.
      reload();
      expect(await screen.findByText(CLOSED)).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("keeps the download it showed when its address can not be reached", async () => {
      fetchMock.mockResolvedValueOnce(reply(200, READY)).mockRejectedValueOnce(new TypeError("offline")).mockResolvedValueOnce(reply(503));
      await openAndArrive(`/install#${TOKEN}`);
      await screen.findByRole("link", { name: DOWNLOAD });
      for (let attempt = 0; attempt < 2; attempt++) {
        reload();
        expect(await screen.findByRole("link", { name: DOWNLOAD })).toHaveAttribute("href", `/api/updates/v1/install/${REF}/Nokka.dmg`);
      }
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("never offers an earlier link's download while a newer one could not be checked", async () => {
      fetchMock.mockResolvedValueOnce(reply(200, READY)).mockResolvedValueOnce(reply(503, { ok: false, code: "UNAVAILABLE" }));
      await openAndArrive(`/install#${TOKEN}`);
      await screen.findByRole("link", { name: DOWNLOAD });
      await openInTab(TOKEN_2);
      arrive();
      expect(await screen.findByText(ERROR)).toBeInTheDocument();

      reload();
      expect(await screen.findByText(MISSING)).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: DOWNLOAD })).not.toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("of a link past its expiry shows it closed, without a download", async () => {
      fetchMock.mockResolvedValueOnce(reply(200, READY));
      await openAndArrive(`/install#${TOKEN}`);
      await screen.findByRole("link", { name: DOWNLOAD });
      vi.setSystemTime(new Date("2026-11-26T03:30:01.000Z"));
      reload();
      expect(await screen.findByText(CLOSED)).toBeInTheDocument();
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    });

    it.each([
      ["a string", "{"],
      ["another shape", { kind: "ready", link: { ...LINK, ref: "not-a-ref" } }],
    ])("asks to reopen the link when what the entry keeps is %s", async (_, value) => {
      view?.unmount();
      window.history.replaceState({ nokkaInstall: value }, "", "/install");
      reload();
      expect(await screen.findByText(MISSING)).toBeInTheDocument();
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    });

    it("keeps what the router keeps in the entry", async () => {
      fetchMock.mockResolvedValueOnce(reply(200, READY));
      view?.unmount();
      window.history.replaceState({ __NA: true, tree: "router" }, "", `/install#${TOKEN}`);
      mount();
      expect(window.history.state).toEqual({ __NA: true, tree: "router" });
      view?.unmount();
      window.history.replaceState({ __NA: true, tree: "router" }, "", "/install");
      mount();
      await screen.findByRole("link", { name: DOWNLOAD });
      expect(window.history.state).toMatchObject({ __NA: true, tree: "router", nokkaInstall: { kind: "ready", link: LINK } });
    });

    it("is never what a tab opened from this one shows, also after that tab reloads", async () => {
      fetchMock.mockResolvedValueOnce(reply(200, READY));
      await openAndArrive(`/install#${TOKEN}`);
      await screen.findByRole("link", { name: DOWNLOAD });
      // window.open('/install?x=1') from this tab: a copy of its session storage, but a new entry.
      const copied = { ...window.sessionStorage };
      newTab();
      for (const [key, value] of Object.entries(copied)) window.sessionStorage.setItem(key, value);
      open("/install?x=1");
      expect(await screen.findByText(MISSING)).toBeInTheDocument();
      reload();
      expect(await screen.findByText(MISSING)).toBeInTheDocument();
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("a page shown again from the back-forward cache", () => {
    const shownAgain = (persisted: boolean) =>
      act(() => {
        window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted }));
      });

    it.each([
      [410, () => screen.findByText(CLOSED)],
      [200, () => screen.findByRole("link", { name: DOWNLOAD })],
    ])("offers no button until the download's address answers (%i)", async (status, find) => {
      let answers!: (value: unknown) => void;
      fetchMock.mockResolvedValueOnce(reply(200, READY)).mockReturnValueOnce(new Promise((resolve) => (answers = resolve)));
      await openAndArrive(`/install#${TOKEN}`);
      await screen.findByRole("link", { name: DOWNLOAD });
      shownAgain(true);
      expect(await screen.findByText("링크를 확인하는 중…")).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: DOWNLOAD })).not.toBeInTheDocument();
      expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "HEAD" });
      await act(async () => answers(reply(status)));
      expect(await find()).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("says a download that expired while the page was away can not be used, without asking", async () => {
      fetchMock.mockResolvedValueOnce(reply(200, READY));
      await openAndArrive(`/install#${TOKEN}`);
      await screen.findByRole("link", { name: DOWNLOAD });
      vi.setSystemTime(new Date("2026-11-26T03:30:00.250Z"));
      shownAgain(true);
      expect(await screen.findByText(CLOSED)).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: DOWNLOAD })).not.toBeInTheDocument();
      expect(window.history.state).toMatchObject({ nokkaInstall: { kind: "closed" } });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("asks nothing when the page is shown for the first time", async () => {
      fetchMock.mockResolvedValueOnce(reply(200, READY));
      await openAndArrive(`/install#${TOKEN}`);
      await screen.findByRole("link", { name: DOWNLOAD });
      shownAgain(false);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("link", { name: DOWNLOAD })).toBeInTheDocument();
    });
  });

  describe("the same link opened again in this browser", () => {
    async function openedOnce() {
      fetchMock.mockResolvedValueOnce(reply(200, READY));
      await openAndArrive(`/install#${TOKEN}`);
      await screen.findByRole("link", { name: DOWNLOAD });
      newTab();
    }

    it("shows its download while its cookie opens it, without using the link again", async () => {
      await openedOnce();
      fetchMock.mockResolvedValueOnce(reply(200));
      await openAndArrive(`/install#${TOKEN}`);
      expect(await screen.findByRole("link", { name: DOWNLOAD })).toHaveAttribute("href", `/api/updates/v1/install/${REF}/Nokka.dmg`);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const [url, init] = fetchMock.mock.calls[1];
      expect(url).toBe(`/api/updates/v1/install/${REF}/Nokka.dmg`);
      expect(init).toMatchObject({ method: "HEAD", credentials: "same-origin", cache: "no-store", referrerPolicy: "no-referrer" });
      expect(stored()).not.toContain(TOKEN);
    });

    it.each([
      [404, "used, as this browser no longer holds its cookie", USED],
      [410, "closed", CLOSED],
    ])("says it is %s once its address answers %i, and forgets it", async (status, _, text) => {
      await openedOnce();
      fetchMock.mockResolvedValueOnce(reply(status)).mockResolvedValueOnce(reply(410, USED_ANSWER));
      await openAndArrive(`/install#${TOKEN}`);
      expect(await screen.findByText(text)).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(window.localStorage.getItem(await openedKey(TOKEN))).toBeNull();

      // Forgotten: the next time, the server answers.
      newTab();
      await openAndArrive(`/install#${TOKEN}`);
      expect(await screen.findByText(USED)).toBeInTheDocument();
      expect(fetchMock.mock.calls[2][0]).toBe(SESSION);
    });

    it("can be retried when its download address can not be reached", async () => {
      const user = userEvent.setup();
      await openedOnce();
      fetchMock.mockRejectedValueOnce(new TypeError("offline")).mockResolvedValueOnce(reply(200));
      await openAndArrive(`/install#${TOKEN}`);
      await user.click(await screen.findByRole("button", { name: "다시 시도 (Try again)" }));
      expect(await screen.findByRole("link", { name: DOWNLOAD })).toBeInTheDocument();
      expect(fetchMock.mock.calls.slice(1).map(([, init]) => init.method)).toEqual(["HEAD", "HEAD"]);
    });

    it("shows its download when another tab opened it while this one asked", async () => {
      fetchMock
        .mockImplementationOnce(async () => {
          // The other tab's answer is kept first; this tab's request finds the link used.
          window.localStorage.setItem(await openedKey(TOKEN), JSON.stringify(LINK));
          return reply(410, USED_ANSWER);
        })
        .mockResolvedValueOnce(reply(200));
      await openAndArrive(`/install#${TOKEN}`);
      expect(await screen.findByRole("link", { name: DOWNLOAD })).toHaveAttribute("href", `/api/updates/v1/install/${REF}/Nokka.dmg`);
      expect(fetchMock.mock.calls.map(([, init]) => init.method)).toEqual(["POST", "HEAD"]);
    });

    it("is kept under the link's hash only, and not past its expiry", async () => {
      await openedOnce();
      expect(Object.keys(window.localStorage)).toEqual([await openedKey(TOKEN)]);
      vi.setSystemTime(new Date("2026-11-26T03:30:01.000Z"));
      fetchMock.mockResolvedValueOnce(reply(410, { ok: false, code: "GONE" }));
      await openAndArrive(`/install#${TOKEN}`);
      expect(await screen.findByText(CLOSED)).toBeInTheDocument();
      expect(fetchMock.mock.calls[1][0]).toBe(SESSION);
      expect(window.localStorage.getItem(await openedKey(TOKEN))).toBeNull();
    });

    it("keeps each link under its own key, never rewriting another tab's link", async () => {
      // Another tab of this browser opened a different link meanwhile.
      const other = await openedKey(TOKEN_2);
      window.localStorage.setItem(other, JSON.stringify({ ...LINK, ref: REF_2, build: 25 }));
      const written = vi.spyOn(Storage.prototype, "setItem");
      fetchMock.mockResolvedValueOnce(reply(200, READY));
      await openAndArrive(`/install#${TOKEN}`);
      await screen.findByRole("link", { name: DOWNLOAD });
      const keys = written.mock.calls.map(([key]) => key).filter((key) => key.startsWith("nokka-install-opened"));
      expect(keys).toEqual([await openedKey(TOKEN)]);
      expect(window.localStorage.getItem(other)).toBe(JSON.stringify({ ...LINK, ref: REF_2, build: 25 }));

      // Both open again in this browser.
      for (const [token, ref] of [[TOKEN, REF], [TOKEN_2, REF_2]]) {
        newTab();
        fetchMock.mockResolvedValueOnce(reply(200));
        await openAndArrive(`/install#${token}`);
        expect(await screen.findByRole("link", { name: DOWNLOAD })).toHaveAttribute("href", `/api/updates/v1/install/${ref}/Nokka.dmg`);
      }
      expect(fetchMock.mock.calls.map(([, init]) => init.method)).toEqual(["POST", "HEAD", "HEAD"]);
    });
  });

  describe("the same link opened at once in two tabs", () => {
    it("turns the tab told it was used into the download as soon as the other tab keeps it", async () => {
      fetchMock.mockResolvedValueOnce(reply(410, USED_ANSWER)).mockResolvedValueOnce(reply(200)).mockResolvedValueOnce(reply(200));
      await openAndArrive(`/install#${TOKEN}`);
      expect(await screen.findByText(USED)).toBeInTheDocument();

      // The first tab's answer arrives after this tab's refusal.
      await keptByAnotherTab(TOKEN, LINK);
      expect(await screen.findByRole("link", { name: DOWNLOAD })).toHaveAttribute("href", `/api/updates/v1/install/${REF}/Nokka.dmg`);
      expect(fetchMock.mock.calls.map(([, init]) => init.method)).toEqual(["POST", "HEAD"]);
      reload();
      expect(await screen.findByRole("link", { name: DOWNLOAD })).toBeInTheDocument();
    });

    it("shows the download on reload when the other tab kept it while this one was closed", async () => {
      fetchMock.mockResolvedValueOnce(reply(410, USED_ANSWER)).mockResolvedValueOnce(reply(200));
      await openAndArrive(`/install#${TOKEN}`);
      expect(await screen.findByText(USED)).toBeInTheDocument();
      view?.unmount();
      view = null;
      window.localStorage.setItem(await openedKey(TOKEN), JSON.stringify(LINK));
      reload();
      expect(await screen.findByRole("link", { name: DOWNLOAD })).toHaveAttribute("href", `/api/updates/v1/install/${REF}/Nokka.dmg`);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("stays used when the kept link's address does not open here, and ignores other links", async () => {
      fetchMock.mockResolvedValueOnce(reply(410, USED_ANSWER)).mockResolvedValueOnce(reply(404));
      await openAndArrive(`/install#${TOKEN}`);
      expect(await screen.findByText(USED)).toBeInTheDocument();
      await keptByAnotherTab(TOKEN_2, { ...LINK, ref: REF_2 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await keptByAnotherTab(TOKEN, LINK);
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      expect(screen.getByText(USED)).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: DOWNLOAD })).not.toBeInTheDocument();
    });
  });

  describe("a tab that can not hand the link over", () => {
    it("checks it in place when nothing can be stored", async () => {
      blockStorage();
      fetchMock.mockResolvedValueOnce(reply(200, READY));
      open(`/install#${TOKEN}`);
      expect(await screen.findByRole("link", { name: DOWNLOAD })).toBeInTheDocument();
      expect(replaceEntry).not.toHaveBeenCalled();
      expect(window.location.hash).toBe("");
      expect(window.name).toBe("");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("checks links in place once this browser dropped a handed-over link", async () => {
      open(`/install#${TOKEN}`);
      expect(replaceEntry).toHaveBeenCalledTimes(1);
      // The browser cleared window.name on the way: asked to reopen, and the next link stays here.
      window.name = "";
      arrive();
      expect(await screen.findByText(MISSING)).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();

      fetchMock.mockResolvedValueOnce(reply(200, READY));
      open(`/install#${TOKEN}`);
      expect(await screen.findByRole("link", { name: DOWNLOAD })).toBeInTheDocument();
      expect(replaceEntry).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("shows only the link opened last when an earlier answer arrives late", async () => {
      blockStorage();
      let answer1!: (value: unknown) => void;
      fetchMock.mockReturnValueOnce(new Promise((resolve) => (answer1 = resolve))).mockResolvedValueOnce(reply(200, READY_2));
      open(`/install#${TOKEN}`);
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      act(() => {
        window.location.hash = TOKEN_2;
      });
      expect(await screen.findByRole("link", { name: DOWNLOAD })).toHaveAttribute("href", `/api/updates/v1/install/${REF_2}/Nokka.dmg`);
      await act(async () => answer1(reply(200, READY)));
      expect(screen.getAllByRole("link", { name: DOWNLOAD })).toHaveLength(1);
      expect(screen.getByRole("link", { name: DOWNLOAD })).toHaveAttribute("href", `/api/updates/v1/install/${REF_2}/Nokka.dmg`);
    });
  });

  it("ignores a token in window.name that this tab did not hand over, and clears it", async () => {
    window.name = `nokka-install:${TOKEN}`;
    open("/install");
    expect(await screen.findByText(MISSING)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(window.name).toBe("");
  });

  it("waits until a prerendered page is shown before it reads the link", async () => {
    let prerendering = true;
    Object.defineProperty(document, "prerendering", { configurable: true, get: () => prerendering });
    try {
      open(`/install#${TOKEN}`);
      expect(replaceEntry).not.toHaveBeenCalled();
      expect(window.location.hash).toBe(`#${TOKEN}`);
      prerendering = false;
      act(() => {
        document.dispatchEvent(new Event("prerenderingchange"));
      });
      expect(replaceEntry).toHaveBeenCalledTimes(1);
      expect(window.location.hash).toBe("");
    } finally {
      delete (document as { prerendering?: boolean }).prerendering;
    }
  });

  it("stops listening once the page is gone", async () => {
    const page = open("/install");
    page.unmount();
    view = null;
    const fired = new Promise((resolve) => window.addEventListener("hashchange", resolve, { once: true }));
    window.location.hash = TOKEN;
    await fired;
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(replaceEntry).not.toHaveBeenCalled();
    expect(window.location.hash).toBe(`#${TOKEN}`);
  });
});

async function sha256(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
