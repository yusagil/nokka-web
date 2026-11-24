import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import ApplicationCard from "../ApplicationCard";
import InstallLinkPanel from "../InstallLinkPanel";
import { copy } from "../copy";
import { installLinkMailBody } from "../format";
import type { AdminApplication } from "@/lib/admin/contracts";

// Fixtures for tests only.
const item: AdminApplication = {
  id: "7",
  name: "김테스트",
  email: "kim@example.com",
  createdAt: "2026-11-19T12:30:00.000Z",
  status: "contacted",
  operatorNote: "",
  lastContactedAt: null,
  updatedAt: "2026-11-19T12:30:00.000Z",
  updatesApproved: true,
  macRegistered: false,
  latestCodeMail: null,
  approvalMail: null,
};
const URL_1 = `https://nokka-web.vercel.app/install#${"a".repeat(42)}A`;
const URL_2 = `https://nokka-web.vercel.app/install#${"b".repeat(42)}A`;
const linkReply = (url: string) => ({
  ok: true,
  link: { url, expiresAt: "2026-11-26T03:30:00.000Z", build: 24, version: "2.7.0" },
});

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
});

const panel = () => render(<InstallLinkPanel item={item} />);

describe("InstallLinkPanel", () => {
  it("issues a link once, shows its address, expiry and a mail draft for the stored email", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(reply(201, linkReply(URL_1)));
    panel();
    expect(screen.queryByRole("textbox", { name: copy.installLinkLabel })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: copy.installLinkIssue }));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/admin/applications/7/install-link");
    expect(init).toMatchObject({ method: "POST", body: "{}", credentials: "same-origin", cache: "no-store" });
    expect(init.headers).toMatchObject({ "X-Admin-Request": "1", "Content-Type": "application/json" });

    expect(screen.getByRole("textbox", { name: copy.installLinkLabel })).toHaveValue(URL_1);
    expect(screen.getByText(copy.installLinkSummary("2.7.0", 24, "2026. 11. 26. 12:30"))).toBeInTheDocument();
    // The draft carries the recipient and subject; the link is pasted in from the copied body.
    const draft = screen.getByRole("link", { name: copy.installLinkCompose });
    expect(draft.getAttribute("href")).toBe(
      `mailto:kim@example.com?subject=${encodeURIComponent(copy.installLinkMailSubject)}`
    );
    expect(draft).toHaveAccessibleDescription(copy.installLinkComposeHint);
    await user.click(screen.getByRole("button", { name: copy.installLinkCopyBody }));
    expect(screen.getByRole("status")).toHaveTextContent(copy.installLinkBodyCopied);
    const body = await navigator.clipboard.readText();
    expect(body).toContain(URL_1);
    expect(body).toContain("2026. 11. 26. 12:30까지");
    // A link opens once, so it is opened on the Mac it installs.
    // One press of the page's button downloads; opening the link uses nothing.
    expect(body).toContain("설치할 Mac에서 링크를 열고 ‘설치 파일 받기’를 누르면 바로 받기 시작합니다. 이 버튼은 한 번만 쓸 수 있고");
    expect(body).not.toContain("처음 연 브라우저");
    expect(body).toContain("김테스트님");
    // A code only when the app asks for one: an installation can take over its registration.
    expect(body).toContain("등록 화면이 열리면 이 이메일 주소로 코드를 받아 이 Mac을 등록하세요.");
    expect(body).not.toContain("코드를 받아 이 Mac을 등록하면");
    expect(screen.getByRole("button", { name: copy.installLinkReissue })).toBeInTheDocument();
  });

  it("opens Gmail's compose window in a new tab without the link in any address", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(reply(201, linkReply(URL_1)));
    panel();
    await user.click(screen.getByRole("button", { name: copy.installLinkIssue }));

    const gmail = screen.getByRole("link", { name: copy.installLinkComposeGmail });
    expect(gmail).toHaveAttribute("target", "_blank");
    expect(gmail).toHaveAttribute("rel", "noopener noreferrer");
    expect(gmail).toHaveAccessibleDescription(copy.installLinkComposeHint);
    const href = new URL(gmail.getAttribute("href")!);
    expect(href.origin).toBe("https://mail.google.com");
    expect(href.searchParams.get("view")).toBe("cm");
    expect(href.searchParams.get("to")).toBe("kim@example.com");
    expect(href.searchParams.get("su")).toBe(copy.installLinkMailSubject);
    expect(href.searchParams.has("body")).toBe(false);
    // The mail-app draft stays in this tab.
    expect(screen.getByRole("link", { name: copy.installLinkCompose })).not.toHaveAttribute("target");
    // No link on the panel carries the token.
    const token = URL_1.split("#")[1];
    for (const a of screen.getAllByRole("link")) {
      expect(a.getAttribute("href")).not.toContain(token);
      expect(decodeURIComponent(a.getAttribute("href")!)).not.toContain(token);
    }

    // A new link replaces the one in the copied body.
    fetchMock.mockResolvedValueOnce(reply(201, linkReply(URL_2)));
    await user.click(screen.getByRole("button", { name: copy.installLinkReissue }));
    await user.click(screen.getByRole("button", { name: copy.installLinkCopyBody }));
    const body = await navigator.clipboard.readText();
    expect(body).toContain(URL_2);
    expect(body).not.toContain(URL_1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shows the whole draft to select by hand when the clipboard refuses the body", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(reply(201, linkReply(URL_1)));
    panel();
    await user.click(screen.getByRole("button", { name: copy.installLinkIssue }));
    expect(screen.queryByRole("textbox", { name: copy.installLinkBodyLabel })).not.toBeInTheDocument();

    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"));
    await user.click(screen.getByRole("button", { name: copy.installLinkCopyBody }));
    expect(screen.getByRole("status")).toHaveTextContent(copy.installLinkBodyCopyFailed);
    const draft = screen.getByRole<HTMLTextAreaElement>("textbox", { name: copy.installLinkBodyLabel });
    expect(draft).toHaveAttribute("readonly");
    expect(draft.value).toBe(copy.installLinkMailBody("김테스트", URL_1, "2026. 11. 26. 12:30"));
    expect(draft.value).toContain("이 버튼은 한 번만 쓸 수 있고");
    expect(draft.value).toContain("등록 화면이 열리면 이 이메일 주소로 코드를 받아 이 Mac을 등록하세요.");
    // Selected for copying by hand.
    // The selection waits for an animation frame, which a busy machine (other suites on Postgres at once) can hold
    // for seconds.
    await vi.waitFor(
      () => {
        expect(draft.selectionStart).toBe(0);
        expect(draft.selectionEnd).toBe(draft.value.length);
      },
      { timeout: 10_000 },
    );
    // Still only a pasted body: no compose link carries the token.
    const token = URL_1.split("#")[1];
    for (const a of screen.getAllByRole("link")) expect(decodeURIComponent(a.getAttribute("href")!)).not.toContain(token);

    // A new link hides the old draft; a refused copy shows the new one.
    fetchMock.mockResolvedValueOnce(reply(201, linkReply(URL_2)));
    await user.click(screen.getByRole("button", { name: copy.installLinkReissue }));
    expect(screen.queryByRole("textbox", { name: copy.installLinkBodyLabel })).not.toBeInTheDocument();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"));
    await user.click(screen.getByRole("button", { name: copy.installLinkCopyBody }));
    const next = screen.getByRole<HTMLTextAreaElement>("textbox", { name: copy.installLinkBodyLabel });
    expect(next.value).toContain(URL_2);
    expect(next.value).not.toContain(URL_1);
  }, 20_000);

  it("copies nothing while a new link is being made, then says to copy again", async () => {
    const user = userEvent.setup();
    let finish!: (value: unknown) => void;
    fetchMock
      .mockResolvedValueOnce(reply(201, linkReply(URL_1)))
      .mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    panel();
    await user.click(screen.getByRole("button", { name: copy.installLinkIssue }));
    await navigator.clipboard.writeText("before");
    const writeText = vi.spyOn(navigator.clipboard, "writeText");

    await user.click(screen.getByRole("button", { name: copy.installLinkReissue }));
    const copyBody = screen.getByRole("button", { name: copy.installLinkCopyBody });
    const copyLink = screen.getByRole("button", { name: copy.installLinkCopy });
    expect(copyBody).toHaveAttribute("aria-disabled", "true");
    expect(copyLink).toHaveAttribute("aria-disabled", "true");
    await user.click(copyBody);
    await user.click(copyLink);
    expect(writeText).not.toHaveBeenCalled();
    expect(await navigator.clipboard.readText()).toBe("before");
    expect(screen.getByRole("status")).toHaveTextContent("");

    finish(reply(201, linkReply(URL_2)));
    await vi.waitFor(() =>
      expect(screen.getByRole("textbox", { name: copy.installLinkLabel })).toHaveValue(URL_2)
    );
    expect(screen.getByRole("status")).toHaveTextContent(copy.installLinkReissued);
    await user.click(screen.getByRole("button", { name: copy.installLinkCopyBody }));
    expect(await navigator.clipboard.readText()).toContain(URL_2);
    expect(screen.getByRole("status")).toHaveTextContent(copy.installLinkBodyCopied);
  });

  it("says nothing of a copy that finishes after a new link or a revoke began", async () => {
    const user = userEvent.setup();
    let reissued!: (value: unknown) => void;
    fetchMock
      .mockResolvedValueOnce(reply(201, linkReply(URL_1)))
      .mockReturnValueOnce(new Promise((resolve) => (reissued = resolve)))
      .mockResolvedValueOnce(reply(200, { ok: true, revoked: 1 }));
    panel();
    await user.click(screen.getByRole("button", { name: copy.installLinkIssue }));

    // A copy of link 1 still writing when the new link is asked for...
    let written!: () => void;
    vi.spyOn(navigator.clipboard, "writeText").mockReturnValueOnce(new Promise<void>((resolve) => (written = resolve)));
    await user.click(screen.getByRole("button", { name: copy.installLinkCopyBody }));
    await user.click(screen.getByRole("button", { name: copy.installLinkReissue }));
    written();
    await Promise.resolve();
    expect(screen.getByRole("status")).not.toHaveTextContent(copy.installLinkBodyCopied);
    reissued(reply(201, linkReply(URL_2)));
    await vi.waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(copy.installLinkReissued));

    // ...and one still writing when the link is revoked.
    vi.spyOn(navigator.clipboard, "writeText").mockReturnValueOnce(new Promise<void>((resolve) => (written = resolve)));
    await user.click(screen.getByRole("button", { name: copy.installLinkCopy }));
    await user.click(screen.getByRole("button", { name: copy.installLinkRevoke }));
    await vi.waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(copy.installLinkRevoked));
    written();
    await Promise.resolve();
    expect(screen.getByRole("status")).toHaveTextContent(copy.installLinkRevoked);
  });

  it("writes one copy at a time, so a slow copy of an old link can't land over the new one", async () => {
    const user = userEvent.setup();
    // A clipboard whose writes take effect only when each one finishes, in the order they finish.
    let clipboard = "";
    const writes: { text: string; finish: () => Promise<void> }[] = [];
    vi.spyOn(navigator.clipboard, "writeText").mockImplementation(
      (text) =>
        new Promise<void>((resolve) => {
          writes.push({
            text,
            finish: async () => {
              clipboard = text;
              resolve();
              await Promise.resolve();
            },
          });
        })
    );
    fetchMock.mockResolvedValueOnce(reply(201, linkReply(URL_1))).mockResolvedValueOnce(reply(201, linkReply(URL_2)));
    panel();
    await user.click(screen.getByRole("button", { name: copy.installLinkIssue }));

    // Link 1's body is still being written when link 2 replaces it.
    await user.click(screen.getByRole("button", { name: copy.installLinkCopyBody }));
    expect(writes).toHaveLength(1);
    expect(screen.getByRole("button", { name: copy.installLinkCopyBody })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: copy.installLinkCopy })).toHaveAttribute("aria-disabled", "true");
    await user.click(screen.getByRole("button", { name: copy.installLinkReissue }));
    expect(screen.getByRole("textbox", { name: copy.installLinkLabel })).toHaveValue(URL_2);

    // A copy of link 2 waits for that write instead of racing it.
    await user.click(screen.getByRole("button", { name: copy.installLinkCopyBody }));
    await user.click(screen.getByRole("button", { name: copy.installLinkCopy }));
    expect(writes).toHaveLength(1);
    // Whatever was started, the last write to start finishes first and the oldest last.
    for (const write of [...writes].reverse()) await act(write.finish);
    expect(writes.map((w) => w.text)).toEqual([installLinkMailBody("김테스트", URL_1, linkReply(URL_1).link.expiresAt)]);
    expect(screen.getByRole("status")).toHaveTextContent(copy.installLinkReissued);
    expect(screen.getByRole("button", { name: copy.installLinkCopyBody })).toHaveAttribute("aria-disabled", "false");

    // Copied again once it is done: link 2 is what the clipboard ends with.
    await user.click(screen.getByRole("button", { name: copy.installLinkCopyBody }));
    expect(writes).toHaveLength(2);
    await act(writes[1].finish);
    expect(clipboard).toBe(installLinkMailBody("김테스트", URL_2, linkReply(URL_2).link.expiresAt));
    expect(clipboard).not.toContain(URL_1);
    expect(screen.getByRole("status")).toHaveTextContent(copy.installLinkBodyCopied);
  });

  it("copies the address and replaces it with a new link when issued again", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(reply(201, linkReply(URL_1))).mockResolvedValueOnce(reply(201, linkReply(URL_2)));
    panel();
    await user.click(screen.getByRole("button", { name: copy.installLinkIssue }));
    await user.click(screen.getByRole("button", { name: copy.installLinkCopy }));
    expect(await navigator.clipboard.readText()).toBe(URL_1);
    expect(screen.getByRole("status")).toHaveTextContent(copy.installLinkCopied);

    await user.click(screen.getByRole("button", { name: copy.installLinkReissue }));
    expect(screen.getByRole("textbox", { name: copy.installLinkLabel })).toHaveValue(URL_2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("revokes the open link, hides its address and says a download already under way can finish", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(reply(201, linkReply(URL_1)))
      .mockResolvedValueOnce(reply(200, { ok: true, revoked: 1 }))
      .mockResolvedValueOnce(reply(200, { ok: true, revoked: 0 }));
    panel();
    await user.click(screen.getByRole("button", { name: copy.installLinkIssue }));
    await user.click(screen.getByRole("button", { name: copy.installLinkRevoke }));
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "DELETE" });
    expect(screen.queryByRole("textbox", { name: copy.installLinkLabel })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(copy.installLinkRevoked);
    expect(copy.installLinkRevoked).toContain("이미 시작된 다운로드는 끝까지 받을 수 있습니다");
    const revokeButton = screen.getByRole("button", { name: copy.installLinkRevoke });
    expect(revokeButton).toHaveAccessibleDescription(copy.installLinkRevokeHint);
    expect(copy.installLinkRevokeHint).toContain("그 링크의 새 요청은 바로 거절되고, 아직 보내지 않은 승인 메일도 취소됩니다");
    expect(copy.installLinkRevokeHint).toContain("이미 시작된 다운로드는 중간에 끊지 않으므로");

    await user.click(screen.getByRole("button", { name: copy.installLinkRevoke }));
    expect(screen.getByRole("status")).toHaveTextContent(copy.installLinkNoneOpen);
  });

  it.each([
    [409, "UPDATES_NOT_APPROVED", copy.installLinkNotApproved],
    [409, "NO_INSTALLER", copy.installLinkNoInstaller],
    [401, "UNAUTHENTICATED", copy.unauthenticated],
    [503, "UNAVAILABLE", copy.installLinkIssueFailed],
  ])("explains a %i %s answer without showing a link", async (status, code, text) => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(reply(status, { ok: false, code }));
    panel();
    await user.click(screen.getByRole("button", { name: copy.installLinkIssue }));
    expect(screen.getByRole("alert")).toHaveTextContent(text);
    expect(screen.queryByRole("textbox", { name: copy.installLinkLabel })).not.toBeInTheDocument();
  });

  it("refuses a malformed success answer and a network failure", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(reply(201, { ok: true, link: { url: "javascript:alert(1)", expiresAt: "x", build: 24, version: "2.7.0" } }))
      .mockRejectedValueOnce(new TypeError("offline"));
    panel();
    await user.click(screen.getByRole("button", { name: copy.installLinkIssue }));
    expect(screen.getByRole("alert")).toHaveTextContent(copy.installLinkIssueFailed);
    await user.click(screen.getByRole("button", { name: copy.installLinkRevoke }));
    expect(screen.getByRole("alert")).toHaveTextContent(copy.installLinkRevokeFailed);
    expect(screen.queryByRole("textbox", { name: copy.installLinkLabel })).not.toBeInTheDocument();
  });

  it("is part of the card only while updates are allowed as saved", () => {
    const props = { expanded: true, onToggle: vi.fn(), onSaved: vi.fn(), onReload: vi.fn(async () => {}) };
    const { rerender } = render(
      <ul>
        <ApplicationCard {...props} item={{ ...item, updatesApproved: false }} />
      </ul>,
    );
    expect(screen.queryByRole("button", { name: copy.installLinkIssue })).not.toBeInTheDocument();
    rerender(
      <ul>
        <ApplicationCard {...props} item={{ ...item, updatedAt: "2026-11-19T13:00:00.000Z" }} />
      </ul>,
    );
    expect(screen.getByRole("heading", { name: copy.installLinkLegend })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: copy.installLinkIssue })).toHaveAttribute("type", "button");
    expect(screen.getByRole("button", { name: copy.installLinkRevoke })).toHaveAttribute("type", "button");
  });
});
