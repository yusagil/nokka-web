import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import ApplicationInbox from "../ApplicationInbox";
import { copy } from "../copy";
import type { AdminApplication } from "@/lib/admin/contracts";

// Fixtures for tests only; the inbox itself never renders made-up entries.
const kim: AdminApplication = {
  id: "11",
  name: "김테스트",
  email: "kim@example.com",
  createdAt: "2026-11-19T12:30:00.000Z",
  status: "new",
  operatorNote: "",
  lastContactedAt: null,
  updatedAt: "2026-11-19T12:30:00.000Z",
  updatesApproved: false,
};
const lee: AdminApplication = {
  ...kim,
  id: "10",
  name: "이테스트",
  email: "lee@example.com",
  status: "contacted",
  lastContactedAt: "2026-11-19T13:00:00.000Z",
};

function reply(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}
const list = (items: AdminApplication[], nextCursor: string | null = null) =>
  reply(200, { ok: true, items, nextCursor });

let fetchMock: ReturnType<typeof vi.fn>;
const requested = (n: number) => {
  const [url, init] = fetchMock.mock.calls[n];
  return { url: String(url), init, body: JSON.parse(init.body) };
};

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ApplicationInbox", () => {
  it("loads the first page and shows each request's name, email, time and status", async () => {
    fetchMock.mockResolvedValueOnce(list([kim, lee]));
    render(<ApplicationInbox />);

    expect(screen.getByRole("status")).toHaveTextContent(copy.loading);
    expect(await screen.findByRole("heading", { name: "김테스트" })).toBeInTheDocument();
    expect(screen.getByText("kim@example.com")).toBeInTheDocument();
    const [first, second] = screen.getAllByRole("listitem");
    expect(within(first).getByText("2026. 11. 19. 21:30")).toHaveAttribute("datetime", kim.createdAt);
    expect(within(first).getByText("신규", { selector: "span" })).toBeInTheDocument();
    expect(within(second).getByText("안내완료", { selector: "span" })).toBeInTheDocument();
    expect(within(second).getByText(/마지막 안내/)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("2건");

    const { url, init, body } = requested(0);
    expect(url).toBe("/api/admin/applications/search");
    expect(init).toMatchObject({ method: "POST", cache: "no-store", credentials: "same-origin" });
    expect(init.headers).toMatchObject({ "Content-Type": "application/json", "X-Admin-Request": "1" });
    expect(body).toEqual({ q: "", status: "all", cursor: null, limit: 20 });
  });

  it("tells an empty inbox apart from a search with no matches", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(list([]));
    render(<ApplicationInbox />);
    expect(await screen.findByText(copy.empty)).toBeInTheDocument();

    fetchMock.mockResolvedValueOnce(list([]));
    await user.type(screen.getByRole("searchbox", { name: copy.searchLabel }), "  nobody ");
    await user.click(screen.getByRole("button", { name: copy.search }));
    expect(await screen.findByText(copy.emptyFiltered)).toBeInTheDocument();
    // The query goes in the POST body only: not in the API URL, not in the page URL.
    expect(requested(1).body.q).toBe("nobody");
    expect(requested(1).url).toBe("/api/admin/applications/search");
    expect(window.location.href).not.toMatch(/nobody/);
  });

  it("filters by status", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(list([kim, lee]));
    render(<ApplicationInbox />);
    await screen.findByRole("heading", { name: "김테스트" });

    fetchMock.mockResolvedValueOnce(list([lee]));
    const filters = screen.getByRole("group", { name: copy.filterLegend });
    await user.click(within(filters).getByRole("radio", { name: "안내완료" }));
    expect(await screen.findByRole("status")).toHaveTextContent("1건");
    expect(screen.queryByText("김테스트")).not.toBeInTheDocument();
    expect(requested(1).body.status).toBe("contacted");
  });

  it("shows a failed load with a retry instead of an empty inbox", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(reply(503, { ok: false, code: "UNAVAILABLE" }));
    render(<ApplicationInbox />);

    expect(await screen.findByRole("alert")).toHaveTextContent(copy.loadFailed);
    expect(screen.queryByText(copy.empty)).not.toBeInTheDocument();

    fetchMock.mockResolvedValueOnce(list([kim]));
    await user.click(screen.getByRole("button", { name: copy.retry }));
    expect(await screen.findByRole("heading", { name: "김테스트" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("treats sign-in problems and malformed lists as failures", async () => {
    fetchMock.mockResolvedValueOnce(reply(401, { ok: false, code: "UNAUTHENTICATED" }));
    const { unmount } = render(<ApplicationInbox />);
    expect(await screen.findByRole("alert")).toHaveTextContent(copy.unauthenticated);
    unmount();

    fetchMock.mockResolvedValueOnce(reply(200, { ok: true, items: [{ id: "1", name: "x" }] }));
    render(<ApplicationInbox />);
    expect(await screen.findByRole("alert")).toHaveTextContent(copy.loadFailed);
  });

  it("loads more with the cursor and keeps what is already shown", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(list([kim], "cursor-1"));
    render(<ApplicationInbox />);
    await screen.findByRole("heading", { name: "김테스트" });
    expect(screen.getByRole("status")).toHaveTextContent("1건 표시 중, 더 있음");

    fetchMock.mockResolvedValueOnce(reply(500, { ok: false, code: "INTERNAL_ERROR" }));
    await user.click(screen.getByRole("button", { name: copy.loadMore }));
    expect(await screen.findByRole("alert")).toHaveTextContent(copy.loadFailed);
    expect(screen.getByText("김테스트")).toBeInTheDocument();

    fetchMock.mockResolvedValueOnce(list([lee]));
    await user.click(screen.getByRole("button", { name: copy.retry }));
    expect(await screen.findByRole("heading", { name: "이테스트" })).toBeInTheDocument();
    expect(screen.getByText("김테스트")).toBeInTheDocument();
    expect(requested(2).body.cursor).toBe("cursor-1");
    expect(screen.queryByRole("button", { name: copy.loadMore })).not.toBeInTheDocument();
  });

  it("shows the saved status in the list once the server confirms it", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(list([kim]));
    render(<ApplicationInbox />);
    await user.click(await screen.findByRole("button", { name: /처리하기 김테스트/ }));

    const saved = { ...kim, status: "hold", updatedAt: "2026-11-19T14:00:00.000Z" };
    fetchMock.mockResolvedValueOnce(reply(200, { ok: true, item: saved }));
    const card = screen.getByRole("listitem");
    await user.click(within(card).getByRole("radio", { name: "보류" }));
    await user.click(within(card).getByRole("button", { name: copy.save }));

    expect(await within(card).findByText(copy.saved)).toBeInTheDocument();
    expect(within(card).getAllByText("보류")).toHaveLength(2); // the badge and the selected option
  });

  it("takes a request out of a filtered list once it is saved into another status", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(list([kim, lee]));
    render(<ApplicationInbox />);
    await screen.findByRole("heading", { name: "김테스트" });

    fetchMock.mockResolvedValueOnce(list([kim]));
    const filters = screen.getByRole("group", { name: copy.filterLegend });
    await user.click(within(filters).getByRole("radio", { name: "신규" }));
    await user.click(await screen.findByRole("button", { name: /처리하기 김테스트/ }));

    const saved = { ...kim, status: "hold", updatedAt: "2026-11-19T14:00:00.000Z" };
    fetchMock.mockResolvedValueOnce(reply(200, { ok: true, item: saved }));
    const card = screen.getByRole("listitem");
    await user.click(within(card).getByRole("radio", { name: "보류" }));
    await user.click(within(card).getByRole("button", { name: copy.save }));

    expect(await screen.findByText(copy.movedOut("보류"))).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "김테스트" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(copy.emptyFiltered);
    expect(screen.getByRole("heading", { level: 2, name: copy.listHeading })).toHaveFocus();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("warns that searching or filtering drops unsaved edits, until they are gone", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(list([kim]));
    render(<ApplicationInbox />);
    await user.click(await screen.findByRole("button", { name: /처리하기 김테스트/ }));
    expect(screen.queryByText(copy.unsaved)).not.toBeInTheDocument();

    await user.type(screen.getByRole("textbox", { name: copy.noteLabel }), "메모");
    expect(screen.getByText(copy.unsaved)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: copy.search })).toHaveAccessibleDescription(copy.unsaved);
    expect(screen.getByRole("group", { name: copy.filterLegend })).toHaveAccessibleDescription(copy.unsaved);

    fetchMock.mockResolvedValueOnce(list([]));
    const filters = screen.getByRole("group", { name: copy.filterLegend });
    await user.click(within(filters).getByRole("radio", { name: "보류" }));
    expect(await screen.findByText(copy.emptyFiltered)).toBeInTheDocument();
    expect(screen.queryByText(copy.unsaved)).not.toBeInTheDocument();
  });
});
