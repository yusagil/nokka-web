import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { replaceEntry, startDownload } from "../entry";
import InstallLinkPage from "../InstallLinkPage";

// jsdom loads no documents and downloads nothing: the page's load in place of its entry and the download
// it starts are recorded, and `arrive` plays the load.
vi.mock("../entry", () => ({ replaceEntry: vi.fn(), startDownload: vi.fn() }));

// Synthetic link secrets (43 base64url characters) and refs for tests only.
const TOKEN = "s".repeat(42) + "A";
const TOKEN_2 = "n".repeat(42) + "A";
const REF = "5a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const REF_2 = "6a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const PATH = `/api/updates/v1/install/${REF}/Nokka.dmg`;
const PATH_2 = `/api/updates/v1/install/${REF_2}/Nokka.dmg`;
// What a link opens, and the session answer that says so: issued since 0009 (sent once) or before it.
const LINK = {
  ref: REF,
  version: "2.7.0",
  build: 24,
  byteLength: 34_863_922,
  expiresAt: "2026-11-26T03:30:00.000Z",
  singleTransfer: true,
};
const READY = { ok: true, ...LINK };
const READY_2 = { ...READY, ref: REF_2, version: "2.7.1", build: 25 };
const READY_OLD = { ...READY, singleTransfer: false };
const USED_ANSWER = { ...LINK, ok: false, code: "USED" };
const DOWNLOAD = "설치 파일 받기 (Download)";
const NOT_STARTED = "받기가 시작되지 않았다면 여기를 누르세요 (Start the download)";
const SESSION = "/api/updates/v1/install/session";
const CHECKING = "링크를 확인하는 중…";
const CLOSED = /이 설치 링크는 사용할 수 없습니다/;
const USED = /이 설치 링크는 이미 사용되었습니다/;
const SPENT = /이 링크로는 더 받을 수 없습니다/;
const STARTED = /브라우저에 설치 파일 받기를 요청했습니다/;
const WAITING = /이 브라우저로 아직 설치 파일을 받지 않았습니다/;
const UNCHECKED = /이 브라우저로 설치 파일을 받았는지 지금은 확인하지 못했습니다/;
const RECHECK = "다시 확인 (Check again)";
const REOPEN = /받은 메일의 링크를 다시 열어 주세요/;
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
  vi.mocked(startDownload).mockReset();
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

/** Another link opened in the same tab: a fragment change, then the page leaves that entry. */
async function openInTab(fragment: string) {
  const before = vi.mocked(replaceEntry).mock.calls.length;
  act(() => {
    window.location.hash = fragment;
  });
  await waitFor(() => expect(replaceEntry).toHaveBeenCalledTimes(before + 1));
}

/** Opens a link and lets the page loaded in place of its entry show its button. */
async function openAndArrive(address: string) {
  open(address);
  expect(replaceEntry).toHaveBeenLastCalledWith(address.split("#")[0]);
  arrive();
  return screen.findByRole("button", { name: DOWNLOAD });
}

/** Opens a link and presses its button. */
async function openAndPress(address = `/install#${TOKEN}`) {
  const user = userEvent.setup();
  await user.click(await openAndArrive(address));
  return user;
}

const bodies = () => fetchMock.mock.calls.filter(([, init]) => init.method === "POST").map(([, init]) => JSON.parse(init.body));
const methods = () => fetchMock.mock.calls.map(([, init]) => init.method);

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
  it("hands the secret over without its entry, then shows the button without sending anything", async () => {
    open(`/install?from=mail#${TOKEN}`);
    // Read, removed from the address, and the page loads again in place of the entry.
    expect(window.location.hash).toBe("");
    expect(window.location.pathname + window.location.search).toBe("/install?from=mail");
    expect(replaceEntry).toHaveBeenCalledTimes(1);
    expect(replaceEntry).toHaveBeenCalledWith("/install?from=mail");
    expect(screen.getByText(CHECKING)).toBeInTheDocument();

    arrive();
    expect(await screen.findByRole("button", { name: DOWNLOAD })).toBeEnabled();
    expect(screen.getByText("설치할 Mac에서 아래 버튼을 누르면 설치 파일을 받기 시작합니다.")).toBeInTheDocument();
    expect(screen.getByText(/링크는 버튼을 누를 때 사용되고, 이 페이지를 열기만 해서는 사용되지 않습니다/)).toBeInTheDocument();
    expect(screen.getByText(/It is used when you press the button, not when this page opens/)).toBeInTheDocument();
    // Loading the page (development effects run twice) uses nothing: no request at all.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(startDownload).not.toHaveBeenCalled();
    // Taken at once; nothing kept holds the secret.
    expect(window.name).toBe("");
    expect(stored()).not.toContain(TOKEN);
    expect(window.history.state).toEqual({ nokkaInstall: { kind: "armed" } });
    expect(document.body.innerHTML).not.toContain(TOKEN);
  });

  it("opens the link with one POST from the button, then starts its download at once", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, READY));
    await openAndPress(`/install?from=mail#${TOKEN}`);
    expect(await screen.findByText(STARTED)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(SESSION);
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin", cache: "no-store", referrerPolicy: "no-referrer" });
    expect(JSON.parse(init.body)).toEqual({ token: TOKEN, action: "download" });
    expect(startDownload).toHaveBeenCalledTimes(1);
    expect(startDownload).toHaveBeenCalledWith(PATH, "Nokka-2.7.0.dmg");

    expect(screen.getByText("Nokka 2.7.0 (24) · 33.2 MB")).toBeInTheDocument();
    expect(screen.getByText(/한 번만 받을 수 있어, 받는 중에 끊겼다면 이 링크로 다시 받을 수 없습니다/)).toBeInTheDocument();
    expect(screen.getByText(/Reply to the email you got it from for a new link/)).toBeInTheDocument();
    // The person's own click when the browser did not start it.
    const again = screen.getByRole("link", { name: NOT_STARTED });
    expect(again).toHaveAttribute("href", PATH);
    expect(again).toHaveAttribute("download", "Nokka-2.7.0.dmg");
    expect(screen.queryByRole("button", { name: DOWNLOAD })).not.toBeInTheDocument();
    expect(window.history.state).toEqual({ nokkaInstall: { kind: "ready", link: LINK } });
    expect(stored()).not.toContain(TOKEN);
    expect(document.body.innerHTML).not.toContain(TOKEN);
  });

  it("sends the link once when the button is pressed again while it is opened", async () => {
    let answer!: (value: unknown) => void;
    fetchMock.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    const user = await openAndPress();
    const button = screen.getByRole("button", { name: DOWNLOAD });
    expect(button).toBeDisabled();
    await user.click(button);
    await act(async () => answer(reply(200, READY)));
    expect(await screen.findByText(STARTED)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(startDownload).toHaveBeenCalledTimes(1);
  });

  it("offers a link issued before the button its download until when, as an ordinary link", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, READY_OLD));
    await openAndPress();
    const download = await screen.findByRole("link", { name: DOWNLOAD });
    expect(download).toHaveAttribute("href", PATH);
    expect(download).toHaveAttribute("download", "Nokka-2.7.0.dmg");
    expect(startDownload).toHaveBeenCalledWith(PATH, "Nokka-2.7.0.dmg");
    expect(screen.getByText(/2026\. 11\. 26\. 12:30 \(KST\)까지 받을 수 있습니다/)).toBeInTheDocument();
    expect(screen.getByText(/until 11\/26\/2026, 12:30 KST/)).toBeInTheDocument();
    expect(screen.queryByText(STARTED)).not.toBeInTheDocument();
  });

  it("asks for a code after installing only when the registration screen opens", async () => {
    await openAndArrive(`/install#${TOKEN}`);
    const steps = screen.getAllByRole("listitem");
    expect(steps[1]).toHaveTextContent(/‘업데이트 확인…’을 선택합니다/);
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
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
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
  ])("says the link can not be used when the button's request gets %i %s", async (status, code) => {
    fetchMock.mockResolvedValueOnce(reply(status, code ? { ok: false, code } : null));
    await openAndPress();
    expect(await screen.findByText(CLOSED)).toBeInTheDocument();
    expect(screen.getByText(/유효 기간이 지났거나, 회수되었거나, 새 링크로 바뀌었습니다/)).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(startDownload).not.toHaveBeenCalled();
    expect(window.history.state).toEqual({ nokkaInstall: { kind: "closed" } });
  });

  describe("a link used before", () => {
    it("says only the browser that pressed first can download when this one holds no session", async () => {
      fetchMock.mockResolvedValueOnce(reply(410, USED_ANSWER)).mockResolvedValueOnce(reply(404));
      await openAndPress();
      expect(await screen.findByText(USED)).toBeInTheDocument();
      expect(screen.getByText(/‘설치 파일 받기’를 처음 누른 브라우저에서만 받을 수 있습니다/)).toBeInTheDocument();
      expect(screen.getByText(/reply to the email you got it from/)).toBeInTheDocument();
      // Asked once, with this browser's cookie only: a HEAD that takes nothing.
      expect(methods()).toEqual(["POST", "HEAD"]);
      expect(fetchMock.mock.calls[1]).toEqual([
        PATH,
        { method: "HEAD", credentials: "same-origin", cache: "no-store", referrerPolicy: "no-referrer" },
      ]);
      expect(startDownload).not.toHaveBeenCalled();
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });

    it.each([
      ["names nothing", { ok: false, code: "USED" }],
      ["names a link past its expiry", { ...USED_ANSWER, expiresAt: "2026-11-24T00:00:00.000Z" }],
    ])("says it was used, without asking more, when the refusal %s", async (_, answer) => {
      fetchMock.mockResolvedValueOnce(reply(410, answer));
      await openAndPress();
      expect(await screen.findByText(USED)).toBeInTheDocument();
      expect(methods()).toEqual(["POST"]);
    });

    it("downloads it in this browser when it holds the session and nothing was sent yet", async () => {
      // Another tab of this browser pressed first, or the first answer was cut short after its cookie arrived.
      fetchMock.mockResolvedValueOnce(reply(410, USED_ANSWER)).mockResolvedValueOnce(reply(200));
      await openAndPress();
      expect(await screen.findByText(STARTED)).toBeInTheDocument();
      expect(startDownload).toHaveBeenCalledWith(PATH, "Nokka-2.7.0.dmg");
      expect(methods()).toEqual(["POST", "HEAD"]);
    });

    it.each([
      ["sent once", USED_ANSWER, SPENT],
      ["issued before the button", { ...USED_ANSWER, singleTransfer: false }, CLOSED],
    ])("says a link %s can not download here any more when its address refuses this browser (410)", async (_, answer, text) => {
      fetchMock.mockResolvedValueOnce(reply(410, answer)).mockResolvedValueOnce(reply(410));
      await openAndPress();
      expect(await screen.findByText(text)).toBeInTheDocument();
      expect(startDownload).not.toHaveBeenCalled();
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    });

    it("can be pressed again when its address can not be reached", async () => {
      fetchMock
        .mockResolvedValueOnce(reply(410, USED_ANSWER))
        .mockRejectedValueOnce(new TypeError("offline"))
        .mockResolvedValueOnce(reply(410, USED_ANSWER))
        .mockResolvedValueOnce(reply(200));
      const user = await openAndPress();
      expect(await screen.findByText(ERROR)).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "다시 시도 (Try again)" }));
      expect(await screen.findByText(STARTED)).toBeInTheDocument();
      expect(methods()).toEqual(["POST", "HEAD", "POST", "HEAD"]);
      expect(startDownload).toHaveBeenCalledTimes(1);
    });
  });

  it("lets the person press again after a failure with the link in memory, then starts the download", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(reply(503, { ok: false, code: "UNAVAILABLE" }))
      .mockResolvedValueOnce(reply(200, { ...READY, ref: "not-a-ref" }))
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => Promise.reject(new TypeError("body cut short")) })
      .mockResolvedValueOnce(reply(200, READY));
    const user = await openAndPress();
    for (let attempt = 0; attempt < 4; attempt++) {
      expect(await screen.findByText(ERROR)).toBeInTheDocument();
      expect(startDownload).not.toHaveBeenCalled();
      await user.click(screen.getByRole("button", { name: "다시 시도 (Try again)" }));
    }
    expect(await screen.findByText(STARTED)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(5);
    for (const body of bodies()) expect(body).toEqual({ token: TOKEN, action: "download" });
    expect(startDownload).toHaveBeenCalledTimes(1);
    // The entry was left before the button, failures included.
    expect(replaceEntry).toHaveBeenCalledTimes(1);
  });

  it("reads a link opened later in the same tab in a new entry, the previous download gone first", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, READY)).mockResolvedValueOnce(reply(200, READY_2));
    const user = await openAndPress();
    expect(await screen.findByRole("link", { name: NOT_STARTED })).toHaveAttribute("href", PATH);

    // Another link, same document: a fragment change. Its entry is left before its button shows.
    await openInTab(TOKEN_2);
    expect(window.location.hash).toBe("");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText(CHECKING)).toBeInTheDocument();
    arrive();
    await user.click(await screen.findByRole("button", { name: DOWNLOAD }));
    expect(await screen.findByRole("link", { name: NOT_STARTED })).toHaveAttribute("href", PATH_2);
    expect(screen.getByText(/Nokka 2\.7\.1 \(25\)/)).toBeInTheDocument();
    expect(bodies()).toEqual([
      { token: TOKEN, action: "download" },
      { token: TOKEN_2, action: "download" },
    ]);
    expect(vi.mocked(startDownload).mock.calls).toEqual([
      [PATH, "Nokka-2.7.0.dmg"],
      [PATH_2, "Nokka-2.7.1.dmg"],
    ]);

    // A malformed fragment: asked to reopen, without a request.
    await openInTab("abc");
    arrive();
    expect(await screen.findByText(MISSING)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(document.body.innerHTML).not.toContain(TOKEN_2);
  });

  it("drops what an earlier link's press answers once another link was opened, and downloads nothing for it", async () => {
    let answer1!: (value: unknown) => void;
    fetchMock.mockReturnValueOnce(new Promise((resolve) => (answer1 = resolve)));
    await openAndPress();
    await openInTab(TOKEN_2);
    expect(window.name).toBe(`nokka-install:${TOKEN_2}`);
    await act(async () => answer1(reply(200, READY)));
    expect(startDownload).not.toHaveBeenCalled();
    expect(screen.queryByText(STARTED)).not.toBeInTheDocument();
    expect(window.history.state?.nokkaInstall).toBeUndefined();

    arrive();
    expect(await screen.findByRole("button", { name: DOWNLOAD })).toBeEnabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  describe("a reload", () => {
    it("before the button asks to reopen the link from the mail, without a request", async () => {
      await openAndArrive(`/install#${TOKEN}`);
      reload();
      expect(await screen.findByText(REOPEN)).toBeInTheDocument();
      expect(screen.getByText(/‘설치 파일 받기’를 누르기 전이었다면 링크는 아직 사용되지 않았습니다/)).toBeInTheDocument();
      expect(screen.getByText(/Open the link from the email again/)).toBeInTheDocument();
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(replaceEntry).toHaveBeenCalledTimes(1);
      reload();
      expect(await screen.findByText(REOPEN)).toBeInTheDocument();
    });

    it("while the button's request is answered asks to reopen the link too", async () => {
      fetchMock.mockReturnValueOnce(new Promise(() => {}));
      await openAndPress();
      reload();
      expect(await screen.findByText(REOPEN)).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it.each([
      ["a refusal", reply(410, { ok: false, code: "GONE" }), CLOSED, null],
      ["a link used elsewhere", reply(410, USED_ANSWER), USED, reply(404)],
      ["a link sent once already", reply(410, USED_ANSWER), SPENT, reply(410)],
    ])("shows %s again without asking", async (_, answer, text, head) => {
      fetchMock.mockResolvedValueOnce(answer);
      if (head) fetchMock.mockResolvedValueOnce(head);
      await openAndPress();
      await screen.findByText(text);
      const asked = fetchMock.mock.calls.length;
      reload();
      expect(await screen.findByText(text)).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledTimes(asked);
    });

    it("offers the download again only once its address still opens, as not sent yet, and never starts it by itself", async () => {
      let opens!: (value: unknown) => void;
      fetchMock.mockResolvedValueOnce(reply(200, READY)).mockReturnValueOnce(new Promise((resolve) => (opens = resolve)));
      const user = await openAndPress();
      await screen.findByText(STARTED);
      reload();
      // No button while its address is asked.
      expect(await screen.findByText(CHECKING)).toBeInTheDocument();
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
      expect(fetchMock.mock.calls[1]).toEqual([
        PATH,
        { method: "HEAD", credentials: "same-origin", cache: "no-store", referrerPolicy: "no-referrer" },
      ]);
      // 200: its one transfer is still there, so nothing says it started.
      await act(async () => opens(reply(200)));
      const button = await screen.findByRole("button", { name: DOWNLOAD });
      expect(screen.getByText(WAITING)).toBeInTheDocument();
      expect(screen.queryByText(STARTED)).not.toBeInTheDocument();
      // The link itself is never sent again, and the download was started by the press only.
      expect(methods()).toEqual(["POST", "HEAD"]);
      expect(startDownload).toHaveBeenCalledTimes(1);

      await user.click(button);
      expect(startDownload).toHaveBeenCalledTimes(2);
      expect(startDownload).toHaveBeenLastCalledWith(PATH, "Nokka-2.7.0.dmg");
      expect(screen.getByText(STARTED)).toBeInTheDocument();
      expect(screen.getByRole("link", { name: NOT_STARTED })).toHaveAttribute("href", PATH);
      expect(methods()).toEqual(["POST", "HEAD"]);
    });

    it.each([
      [410, "its one transfer started"],
      [404, "the refusal cleared its cookie"],
    ])("says a link sent once can not download any more when its address answers %i (%s)", async (status) => {
      fetchMock.mockResolvedValueOnce(reply(200, READY)).mockResolvedValueOnce(reply(status));
      await openAndPress();
      await screen.findByText(STARTED);
      reload();
      expect(await screen.findByText(SPENT)).toBeInTheDocument();
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
      expect(window.history.state).toEqual({ nokkaInstall: { kind: "spent" } });
      reload();
      expect(await screen.findByText(SPENT)).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it.each([410, 404])("says a link issued before the button is closed when its address answers %i", async (status) => {
      fetchMock.mockResolvedValueOnce(reply(200, READY_OLD)).mockResolvedValueOnce(reply(status));
      await openAndPress();
      await screen.findByRole("link", { name: DOWNLOAD });
      reload();
      expect(await screen.findByText(CLOSED)).toBeInTheDocument();
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    });

    it("says it could not check a link sent once when its address can not be reached, and checks again on request", async () => {
      let answers!: (value: unknown) => void;
      fetchMock
        .mockResolvedValueOnce(reply(200, READY))
        .mockRejectedValueOnce(new TypeError("offline"))
        .mockResolvedValueOnce(reply(503))
        .mockReturnValueOnce(new Promise((resolve) => (answers = resolve)));
      const user = await openAndPress();
      await screen.findByText(STARTED);
      for (let attempt = 0; attempt < 2; attempt++) {
        reload();
        // It may have been sent (a download may have taken it): nothing says it was not, and nothing offers it.
        expect(await screen.findByText(UNCHECKED)).toBeInTheDocument();
        expect(screen.getByText(/We couldn't check right now/)).toBeInTheDocument();
        expect(screen.queryByText(WAITING)).not.toBeInTheDocument();
        expect(screen.queryByText(STARTED)).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: DOWNLOAD })).not.toBeInTheDocument();
        expect(screen.queryByRole("link")).not.toBeInTheDocument();
        // The entry keeps the download, so the next reload asks again.
        expect(window.history.state).toEqual({ nokkaInstall: { kind: "ready", link: LINK } });
      }

      await user.click(screen.getByRole("button", { name: RECHECK }));
      expect(await screen.findByText(CHECKING)).toBeInTheDocument();
      expect(fetchMock.mock.calls[3][1]).toMatchObject({ method: "HEAD" });
      await act(async () => answers(reply(200)));
      expect(await screen.findByText(WAITING)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: DOWNLOAD })).toBeInTheDocument();
      expect(methods()).toEqual(["POST", "HEAD", "HEAD", "HEAD"]);
      expect(startDownload).toHaveBeenCalledTimes(1);
    });

    it.each([
      [410, SPENT],
      [503, UNCHECKED],
    ])("says what a check asked again finds (%i)", async (status, text) => {
      fetchMock.mockResolvedValueOnce(reply(200, READY)).mockResolvedValueOnce(reply(503)).mockResolvedValueOnce(reply(status));
      const user = await openAndPress();
      await screen.findByText(STARTED);
      reload();
      await user.click(await screen.findByRole("button", { name: RECHECK }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
      expect(await screen.findByText(text)).toBeInTheDocument();
    });

    it("keeps the download of a link issued before the button when its address can not be reached", async () => {
      fetchMock.mockResolvedValueOnce(reply(200, READY_OLD)).mockRejectedValueOnce(new TypeError("offline"));
      await openAndPress();
      await screen.findByRole("link", { name: DOWNLOAD });
      reload();
      expect(await screen.findByRole("link", { name: DOWNLOAD })).toHaveAttribute("href", PATH);
      expect(screen.queryByText(UNCHECKED)).not.toBeInTheDocument();
    });

    it("of a link past its expiry shows it closed, without a download", async () => {
      fetchMock.mockResolvedValueOnce(reply(200, READY));
      await openAndPress();
      await screen.findByText(STARTED);
      vi.setSystemTime(new Date("2026-11-26T03:30:01.000Z"));
      reload();
      expect(await screen.findByText(CLOSED)).toBeInTheDocument();
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("shows a download an earlier page kept (without how it is sent) as a link issued before the button", async () => {
      const kept: Record<string, unknown> = { ...LINK };
      delete kept.singleTransfer;
      view?.unmount();
      window.history.replaceState({ nokkaInstall: { kind: "ready", link: kept } }, "", "/install");
      fetchMock.mockResolvedValueOnce(reply(200));
      reload();
      expect(await screen.findByRole("link", { name: DOWNLOAD })).toHaveAttribute("href", PATH);
      expect(startDownload).not.toHaveBeenCalled();
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
      await userEvent.setup().click(await screen.findByRole("button", { name: DOWNLOAD }));
      await screen.findByText(STARTED);
      expect(window.history.state).toEqual({ __NA: true, tree: "router", nokkaInstall: { kind: "ready", link: LINK } });
    });

    it("is never what a tab opened from this one shows, also after that tab reloads", async () => {
      fetchMock.mockResolvedValueOnce(reply(200, READY));
      await openAndPress();
      await screen.findByText(STARTED);
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

    it("keeps the button of a link still in memory, without asking", async () => {
      fetchMock.mockResolvedValueOnce(reply(200, READY));
      const button = await openAndArrive(`/install#${TOKEN}`);
      shownAgain(true);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(fetchMock).not.toHaveBeenCalled();
      await userEvent.setup().click(button);
      expect(await screen.findByText(STARTED)).toBeInTheDocument();
      expect(bodies()).toEqual([{ token: TOKEN, action: "download" }]);
    });

    it.each([
      [410, () => screen.findByText(SPENT)],
      [200, () => screen.findByRole("button", { name: DOWNLOAD })],
    ])("offers no button until the download's address answers (%i)", async (status, find) => {
      let answers!: (value: unknown) => void;
      fetchMock.mockResolvedValueOnce(reply(200, READY)).mockReturnValueOnce(new Promise((resolve) => (answers = resolve)));
      await openAndPress();
      await screen.findByText(STARTED);
      shownAgain(true);
      expect(await screen.findByText(CHECKING)).toBeInTheDocument();
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
      expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "HEAD" });
      await act(async () => answers(reply(status)));
      expect(await find()).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(startDownload).toHaveBeenCalledTimes(1);
    });

    it("says a download that expired while the page was away can not be used, without asking", async () => {
      fetchMock.mockResolvedValueOnce(reply(200, READY));
      await openAndPress();
      await screen.findByText(STARTED);
      vi.setSystemTime(new Date("2026-11-26T03:30:00.250Z"));
      shownAgain(true);
      expect(await screen.findByText(CLOSED)).toBeInTheDocument();
      expect(window.history.state).toMatchObject({ nokkaInstall: { kind: "closed" } });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("asks nothing when the page is shown for the first time", async () => {
      fetchMock.mockResolvedValueOnce(reply(200, READY));
      await openAndPress();
      await screen.findByText(STARTED);
      shownAgain(false);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("link", { name: NOT_STARTED })).toBeInTheDocument();
    });
  });

  describe("a tab that can not hand the link over", () => {
    it("keeps it in place when nothing can be stored, and opens it from the button", async () => {
      blockStorage();
      fetchMock.mockResolvedValueOnce(reply(200, READY));
      open(`/install#${TOKEN}`);
      await userEvent.setup().click(await screen.findByRole("button", { name: DOWNLOAD }));
      expect(await screen.findByText(STARTED)).toBeInTheDocument();
      expect(replaceEntry).not.toHaveBeenCalled();
      expect(window.location.hash).toBe("");
      expect(window.name).toBe("");
      expect(bodies()).toEqual([{ token: TOKEN, action: "download" }]);
    });

    it("keeps links in place once this browser dropped a handed-over link", async () => {
      open(`/install#${TOKEN}`);
      expect(replaceEntry).toHaveBeenCalledTimes(1);
      // The browser cleared window.name on the way: asked to reopen, and the next link stays here.
      window.name = "";
      arrive();
      expect(await screen.findByText(MISSING)).toBeInTheDocument();

      open(`/install#${TOKEN}`);
      expect(await screen.findByRole("button", { name: DOWNLOAD })).toBeEnabled();
      expect(replaceEntry).toHaveBeenCalledTimes(1);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("presses only the link opened last", async () => {
      blockStorage();
      fetchMock.mockResolvedValueOnce(reply(200, READY_2));
      open(`/install#${TOKEN}`);
      await screen.findByRole("button", { name: DOWNLOAD });
      act(() => {
        window.location.hash = TOKEN_2;
      });
      await waitFor(() => expect(window.location.hash).toBe(""));
      await userEvent.setup().click(await screen.findByRole("button", { name: DOWNLOAD }));
      expect(await screen.findByRole("link", { name: NOT_STARTED })).toHaveAttribute("href", PATH_2);
      expect(bodies()).toEqual([{ token: TOKEN_2, action: "download" }]);
    });
  });

  it("ignores a token in window.name that this tab did not hand over, and clears it", async () => {
    window.name = `nokka-install:${TOKEN}`;
    open("/install");
    expect(await screen.findByText(MISSING)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(window.name).toBe("");
  });

  it("removes what pages from before the button kept for each link they opened", async () => {
    window.localStorage.setItem(`nokka-install-opened:${"a".repeat(64)}`, JSON.stringify(LINK));
    window.localStorage.setItem(`nokka-install-opened:${"b".repeat(64)}`, "{");
    window.localStorage.setItem("unrelated", "kept");
    open("/install");
    await screen.findByText(MISSING);
    expect(Object.keys(window.localStorage)).toEqual(["unrelated"]);
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
      expect(fetchMock).not.toHaveBeenCalled();
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
