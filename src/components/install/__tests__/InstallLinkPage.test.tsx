import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import InstallLinkPage from "../InstallLinkPage";

// Synthetic link secrets (43 base64url characters) and refs for tests only.
const TOKEN = "s".repeat(42) + "A";
const TOKEN_2 = "n".repeat(42) + "A";
const TOKEN_REVOKED = "r".repeat(42) + "A";
const REF = "5a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const REF_2 = "6a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const READY = { ok: true, ref: REF, version: "2.7.0", build: 24, byteLength: 34_863_922, expiresAt: "2026-11-26T03:30:00.000Z" };
const READY_2 = { ...READY, ref: REF_2, version: "2.7.1", build: 25 };
const DOWNLOAD = "설치 파일 받기 (Download)";

function reply(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

function open(address: string) {
  window.history.replaceState(null, "", address);
  return render(
    <StrictMode>
      <InstallLinkPage />
    </StrictMode>,
  );
}

describe("InstallLinkPage", () => {
  it("moves the secret from the fragment into one POST body and removes it from the address", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, READY));
    open(`/install?from=mail#${TOKEN}`);
    expect(await screen.findByRole("link", { name: "설치 파일 받기 (Download)" })).toBeInTheDocument();

    expect(window.location.hash).toBe("");
    expect(window.location.pathname + window.location.search).toBe("/install?from=mail");
    // Once, even though development effects run twice.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/updates/v1/install/session");
    expect(String(url)).not.toContain(TOKEN);
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin", cache: "no-store", referrerPolicy: "no-referrer" });
    expect(JSON.parse(init.body)).toEqual({ token: TOKEN });
  });

  it("offers an ordinary link to the fixed download address, with what it serves and until when", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, READY));
    open(`/install#${TOKEN}`);
    const download = await screen.findByRole("link", { name: "설치 파일 받기 (Download)" });
    expect(download).toHaveAttribute("href", `/api/updates/v1/install/${REF}/Nokka.dmg`);
    expect(download).toHaveAttribute("download", "Nokka-2.7.0.dmg");
    expect(download.getAttribute("href")).not.toContain(TOKEN);
    expect(screen.getByText("Nokka 2.7.0 (24) · 33.2 MB")).toBeInTheDocument();
    expect(screen.getByText(/2026\. 11\. 26\. 12:30 \(KST\)까지 받을 수 있습니다/)).toBeInTheDocument();
    expect(screen.getByText(/until 11\/26\/2026, 12:30 KST/)).toBeInTheDocument();
    expect(screen.getByText(/‘업데이트 확인…’을 선택합니다/)).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(TOKEN);
  });

  it.each([
    ["no fragment", "/install"],
    ["a malformed fragment", "/install#abc"],
    ["a padded fragment", `/install#${"s".repeat(42)}=`],
  ])("asks to reopen the link for %s, without a request", async (_, address) => {
    open(address);
    expect(await screen.findByText("링크 주소가 완전하지 않습니다. 받은 링크를 그대로 다시 열어 주세요.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("");
  });

  it.each([404, 410])("says the link can not be used when the server answers %i", async (status) => {
    fetchMock.mockResolvedValueOnce(reply(status, { ok: false, code: status === 404 ? "NOT_FOUND" : "GONE" }));
    open(`/install#${TOKEN}`);
    expect(await screen.findByText(/이 설치 링크는 사용할 수 없습니다/)).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("lets the person retry after a failure without the fragment, then shows the download", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(reply(503, { ok: false, code: "UNAVAILABLE" }))
      .mockResolvedValueOnce(reply(200, { ...READY, ref: "not-a-ref" }))
      .mockResolvedValueOnce(reply(200, READY));
    open(`/install#${TOKEN}`);
    for (let attempt = 0; attempt < 3; attempt++) {
      expect(await screen.findByText(/지금은 링크를 확인하지 못했습니다/)).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "다시 시도 (Try again)" }));
    }
    expect(await screen.findByRole("link", { name: "설치 파일 받기 (Download)" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    for (const [, init] of fetchMock.mock.calls) expect(JSON.parse(init.body)).toEqual({ token: TOKEN });
    expect(window.location.hash).toBe("");
  });

  it("checks a link opened later in the same tab, removing its fragment and the previous download first", async () => {
    let answer2!: (value: unknown) => void;
    fetchMock
      .mockResolvedValueOnce(reply(200, READY))
      .mockReturnValueOnce(new Promise((resolve) => (answer2 = resolve)))
      .mockResolvedValueOnce(reply(410, { ok: false, code: "GONE" }));
    open(`/install#${TOKEN}`);
    expect(await screen.findByRole("link", { name: DOWNLOAD })).toHaveAttribute("href", `/api/updates/v1/install/${REF}/Nokka.dmg`);

    // Another link, same document: no reload, only a fragment change.
    act(() => {
      window.location.hash = TOKEN_2;
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ token: TOKEN_2 });
    expect(window.location.hash).toBe("");
    // While it is checked, the previous link's download is gone.
    expect(screen.queryByRole("link", { name: DOWNLOAD })).not.toBeInTheDocument();
    expect(screen.getByText("링크를 확인하는 중…")).toBeInTheDocument();
    await act(async () => answer2(reply(200, READY_2)));
    const second = await screen.findByRole("link", { name: DOWNLOAD });
    expect(second).toHaveAttribute("href", `/api/updates/v1/install/${REF_2}/Nokka.dmg`);
    expect(screen.getByText(/Nokka 2\.7\.1 \(25\)/)).toBeInTheDocument();

    // A revoked link's fragment: the shown download is replaced by the refusal.
    act(() => {
      window.location.hash = TOKEN_REVOKED;
    });
    expect(await screen.findByText(/이 설치 링크는 사용할 수 없습니다/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: DOWNLOAD })).not.toBeInTheDocument();
    expect(window.location.hash).toBe("");

    // A malformed fragment: asked to reopen, without a request.
    act(() => {
      window.location.hash = "abc";
    });
    expect(await screen.findByText(/링크 주소가 완전하지 않습니다/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(window.location.hash).toBe("");
    expect(document.body.innerHTML).not.toContain(TOKEN_2);
  });

  it("shows only the link opened last when an earlier answer arrives late", async () => {
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

  it("stops listening once the page is gone", async () => {
    const view = open("/install");
    view.unmount();
    const fired = new Promise((resolve) => window.addEventListener("hashchange", resolve, { once: true }));
    window.location.hash = TOKEN;
    await fired;
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(window.location.hash).toBe(`#${TOKEN}`);
  });
});
