import { render, screen } from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import ApplicationCard from "../ApplicationCard";
import { copy } from "../copy";
import type { AdminApplication } from "@/lib/admin/contracts";

// Fixture for tests only.
const item: AdminApplication = {
  id: "7",
  name: "김테스트",
  email: "kim@example.com",
  createdAt: "2026-11-19T12:30:00.000Z",
  status: "new",
  operatorNote: "",
  lastContactedAt: null,
  updatedAt: "2026-11-19T12:30:00.000Z",
  updatesApproved: false,
};

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

function renderCard(overrides: Partial<Parameters<typeof ApplicationCard>[0]> = {}) {
  const props = {
    item,
    expanded: true,
    onToggle: vi.fn(),
    onSaved: vi.fn(),
    onReload: vi.fn(async () => {}),
    ...overrides,
  };
  const view = render(
    <ul>
      <ApplicationCard {...props} />
    </ul>
  );
  return { ...view, props };
}

/** Holds the record like the inbox does, so a save feeds the stored item back into the card. */
function Inbox({ onSaved }: { onSaved: (item: AdminApplication, stillEditing: boolean) => void }) {
  const [current, setCurrent] = useState(item);
  return (
    <ul>
      <ApplicationCard
        item={current}
        expanded
        onToggle={() => {}}
        onSaved={(saved, stillEditing) => {
          setCurrent(saved);
          onSaved(saved, stillEditing);
        }}
        onReload={async () => {}}
      />
    </ul>
  );
}

describe("ApplicationCard", () => {
  it("keeps the editor out of reach until opened", async () => {
    const user = userEvent.setup();
    const { props, rerender } = renderCard({ expanded: false });
    const toggle = screen.getByRole("button", { name: /처리하기 김테스트/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("textbox", { name: copy.noteLabel })).not.toBeInTheDocument();

    await user.click(toggle);
    expect(props.onToggle).toHaveBeenCalledTimes(1);
    rerender(
      <ul>
        <ApplicationCard {...props} expanded />
      </ul>
    );
    expect(screen.getByRole("button", { name: /접기 김테스트/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("textbox", { name: copy.noteLabel })).toBeVisible();
  });

  it("sends only what changed and reports saved once the server returns the record", async () => {
    const user = userEvent.setup();
    const consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m)
    );
    let finish: (value: unknown) => void = () => {};
    fetchMock.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const { props } = renderCard();

    await user.type(screen.getByRole("textbox", { name: copy.noteLabel }), "다음 주 연락");
    await user.click(screen.getByRole("button", { name: copy.save }));
    await user.click(screen.getByRole("button", { name: copy.saving }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(copy.saved)).not.toBeInTheDocument();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/admin/applications/7");
    expect(init.method).toBe("PATCH");
    expect(init.headers).toMatchObject({ "Content-Type": "application/json", "X-Admin-Request": "1" });
    expect(JSON.parse(init.body)).toEqual({
      operatorNote: "다음 주 연락",
      expectedUpdatedAt: item.updatedAt,
    });

    const stored = { ...item, operatorNote: "다음 주 연락", updatedAt: "2026-11-19T14:00:00.000Z" };
    finish(reply(200, { ok: true, item: stored }));
    expect(await screen.findByText(copy.saved)).toBeInTheDocument();
    expect(props.onSaved).toHaveBeenCalledWith(stored, false);
    const logged = consoleSpies.flatMap((spy) => spy.mock.calls.flat()).join(" ");
    expect(logged).not.toMatch(/kim@example\.com|다음 주 연락/);
  });

  it("turns updates on with its own field and keeps the status and note", async () => {
    const user = userEvent.setup();
    const stored = { ...item, updatesApproved: true, updatedAt: "2026-11-19T14:00:00.000Z" };
    fetchMock.mockResolvedValue(reply(200, { ok: true, item: stored }));
    const { props } = renderCard();

    const toggle = screen.getByRole("checkbox", { name: copy.updatesLabel });
    expect(toggle).not.toBeChecked();
    expect(toggle).toHaveAccessibleDescription(copy.updatesHint);
    await user.click(toggle);
    await user.click(screen.getByRole("button", { name: copy.save }));

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      updatesApproved: true,
      expectedUpdatedAt: item.updatedAt,
    });
    expect(await screen.findByText(copy.saved)).toBeInTheDocument();
    expect(props.onSaved).toHaveBeenCalledWith(stored, false);
  });

  it("warns before an approval is withdrawn and shows who is allowed", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(reply(200, { ok: true, item: { ...item, updatedAt: "2026-11-19T14:00:00.000Z" } }));
    renderCard({ item: { ...item, updatesApproved: true } });

    expect(screen.getByText(copy.updatesApprovedBadge, { selector: "span" })).toBeInTheDocument();
    const toggle = screen.getByRole("checkbox", { name: copy.updatesLabel });
    expect(toggle).toBeChecked();
    await user.click(toggle);
    expect(toggle).toHaveAccessibleDescription(copy.updatesRevokeWarning);
    await user.click(screen.getByRole("button", { name: copy.save }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      updatesApproved: false,
      expectedUpdatedAt: item.updatedAt,
    });
  });

  it("keeps edits made while a save is in flight, and leaves them unsaved", async () => {
    const user = userEvent.setup();
    let finish: (value: unknown) => void = () => {};
    fetchMock.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const onSaved = vi.fn();
    render(<Inbox onSaved={onSaved} />);
    const note = screen.getByRole("textbox", { name: copy.noteLabel });

    await user.type(note, "A");
    await user.click(screen.getByRole("button", { name: copy.save }));
    await user.type(note, "B");
    await user.click(screen.getByRole("radio", { name: "보류" }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      operatorNote: "A",
      expectedUpdatedAt: item.updatedAt,
    });

    const stored = { ...item, operatorNote: "A", updatedAt: "2026-11-19T14:00:00.000Z" };
    finish(reply(200, { ok: true, item: stored }));
    expect(await screen.findByText(copy.savedWithPending)).toBeInTheDocument();
    expect(note).toHaveValue("AB");
    expect(screen.getByRole("radio", { name: "보류" })).toBeChecked();
    expect(onSaved).toHaveBeenCalledWith(stored, true);

    // The newer draft is saved next, against the stored record's updatedAt.
    fetchMock.mockResolvedValueOnce(
      reply(200, { ok: true, item: { ...stored, status: "hold", operatorNote: "AB", updatedAt: "2026-11-19T14:05:00.000Z" } })
    );
    await user.click(screen.getByRole("button", { name: copy.save }));
    expect(await screen.findByText(copy.saved)).toBeInTheDocument();
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      status: "hold",
      operatorNote: "AB",
      expectedUpdatedAt: stored.updatedAt,
    });
  });

  it("does not send when nothing changed or the note is too long", async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByRole("button", { name: copy.save }));
    expect(screen.getByText(copy.noChanges)).toBeInTheDocument();

    const note = screen.getByRole("textbox", { name: copy.noteLabel });
    await user.click(note);
    await user.paste("가".repeat(501));
    expect(screen.getByText("501/500")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: copy.save }));
    expect(note).toHaveFocus();
    expect(note).toHaveAttribute("aria-invalid", "true");
    expect(note).toHaveAccessibleDescription(expect.stringContaining(copy.noteTooLong(500)));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the edit and offers a reload when someone else changed the record first", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(reply(409, { ok: false, code: "CONFLICT" }));
    const { props } = renderCard();
    await user.click(screen.getByRole("radio", { name: "안내완료" }));
    await user.click(screen.getByRole("button", { name: copy.save }));

    expect(await screen.findByRole("alert")).toHaveTextContent(copy.conflict);
    expect(screen.getByRole("radio", { name: "안내완료" })).toBeChecked();
    expect(props.onSaved).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: copy.reload }));
    expect(props.onReload).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: copy.save })).toHaveFocus();
  });

  it("lets you retry after a failed save, and shows the server's note error by the field", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(reply(503, { ok: false, code: "UNAVAILABLE" }));
    renderCard();
    await user.click(screen.getByRole("radio", { name: "보류" }));
    await user.click(screen.getByRole("button", { name: copy.save }));
    expect(await screen.findByRole("alert")).toHaveTextContent(copy.saveFailed);
    expect(screen.getByRole("radio", { name: "보류" })).toBeChecked();

    fetchMock.mockResolvedValueOnce(
      reply(400, { ok: false, code: "VALIDATION_ERROR", fieldErrors: { operatorNote: "TOO_LONG" } })
    );
    await user.click(screen.getByRole("button", { name: copy.save }));
    const note = screen.getByRole("textbox", { name: copy.noteLabel });
    await vi.waitFor(() => expect(note).toHaveFocus());
    expect(note).toHaveAccessibleDescription(expect.stringContaining(copy.noteTooLong(500)));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("opens a mail draft without saving anything or changing the status", async () => {
    renderCard();
    const compose = screen.getByRole("link", { name: copy.compose });
    expect(compose.getAttribute("href")).toMatch(/^mailto:kim@example\.com\?subject=/);
    expect(compose).toHaveAccessibleDescription(copy.composeHint);
    expect(screen.getByRole("radio", { name: "신규" })).toBeChecked();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
