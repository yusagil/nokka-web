import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import ApplicationCard from "../ApplicationCard";
import InstallLinkPanel from "../InstallLinkPanel";
import { copy } from "../copy";
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
    const draft = screen.getByRole("link", { name: copy.installLinkCompose });
    const href = draft.getAttribute("href")!;
    expect(href.startsWith("mailto:kim@example.com?subject=")).toBe(true);
    const body = decodeURIComponent(href.split("&body=")[1]);
    expect(body).toContain(URL_1);
    expect(body).toContain("2026. 11. 26. 12:30까지");
    expect(body).toContain("김테스트님");
    // A code only when the app asks for one: an installation can take over its registration.
    expect(body).toContain("등록 화면이 열리면 이 이메일 주소로 코드를 받아 이 Mac을 등록하세요.");
    expect(body).not.toContain("코드를 받아 이 Mac을 등록하면");
    expect(screen.getByRole("button", { name: copy.installLinkReissue })).toBeInTheDocument();
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
    expect(copy.installLinkRevokeHint).toContain("새 요청(이어 받기 포함)은 바로 거절됩니다");
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
