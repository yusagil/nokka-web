import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import en from "@/dictionaries/en.json";
import ko from "@/dictionaries/ko.json";
import ApplicationForm from "../ApplicationForm";

const form = en.apply.form;

function reply(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function fillAndSubmit(name: string, email: string, options?: Parameters<typeof userEvent.setup>[0]) {
  const user = userEvent.setup(options);
  render(<ApplicationForm dict={form} locale="en" />);
  await user.type(screen.getByLabelText("Name"), name);
  await user.type(screen.getByLabelText("Email"), email);
  await user.click(screen.getByRole("button", { name: form.submit }));
  return user;
}

describe("ApplicationForm", () => {
  it("asks only for a name and an email, and posts instead of putting them in the URL", () => {
    const { container } = render(<ApplicationForm dict={form} locale="en" />);
    expect(screen.getAllByRole("textbox")).toHaveLength(2);
    expect(screen.getByText(form.purpose)).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveAttribute("autocomplete", "name");
    expect(screen.getByLabelText("Email")).toHaveAttribute("type", "email");
    expect(container.querySelector("form")).toHaveAttribute("method", "post");
  });

  it("shows field errors and focuses the first one without sending anything", async () => {
    const user = userEvent.setup();
    render(<ApplicationForm dict={form} locale="en" />);
    await user.click(screen.getByRole("button", { name: form.submit }));

    const name = screen.getByLabelText("Name");
    expect(name).toHaveFocus();
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAccessibleDescription(form.errors.nameRequired);
    expect(screen.getByLabelText("Email")).toHaveAccessibleDescription(form.errors.emailRequired);

    await user.type(name, "   ");
    await user.type(screen.getByLabelText("Email"), "kim@example");
    await user.click(screen.getByRole("button", { name: form.submit }));
    expect(name).toHaveAccessibleDescription(form.errors.nameRequired);

    await user.type(name, "Kim");
    await user.click(screen.getByRole("button", { name: form.submit }));
    expect(screen.getByLabelText("Email")).toHaveFocus();
    expect(screen.getByLabelText("Email")).toHaveAccessibleDescription(form.errors.emailInvalid);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the trimmed entries as JSON and confirms only once the server stored them", async () => {
    const consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m)
    );
    fetchMock.mockResolvedValue(reply(200, { ok: true }));
    await fillAndSubmit("  Kim  ", " kim@example.com ");

    const done = await screen.findByRole("heading", { name: form.doneHeading });
    expect(done).toHaveFocus();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/applications");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body)).toEqual({ name: "Kim", email: "kim@example.com" });
    const logged = consoleSpies.flatMap((spy) => spy.mock.calls.flat()).join(" ");
    expect(logged).not.toMatch(/kim@example\.com/);
  });

  it("says what happens next and links to the same-language update guide, carrying nothing from the form", async () => {
    fetchMock.mockResolvedValue(reply(200, { ok: true }));
    await fillAndSubmit("Kim", "kim@example.com");

    const done = await screen.findByRole("heading", { name: form.doneHeading });
    const panel = done.parentElement!;
    expect(panel).toHaveTextContent(form.doneBody);
    const link = screen.getByRole("link", { name: form.doneLink });
    expect(link).toHaveAttribute("href", "/en/updates");
    expect(panel.innerHTML).not.toMatch(/kim/i);
  });

  it("tells people who already use Nokka to register from the app's update check, marking the Korean label", async () => {
    fetchMock.mockResolvedValue(reply(200, { ok: true }));
    await fillAndSubmit("Kim", "kim@example.com");

    const done = await screen.findByRole("heading", { name: form.doneHeading });
    const panel = done.parentElement!;
    expect(panel).toHaveTextContent(form.doneExisting);
    const label = panel.querySelector('[lang="ko"]');
    expect(label).toHaveTextContent(/^업데이트 확인…$/);
    expect(label?.parentElement).toHaveTextContent("‘업데이트 확인…’ (Check for Updates)");
  });

  it("gives the Korean confirmation and the Korean update guide", async () => {
    fetchMock.mockResolvedValue(reply(200, { ok: true }));
    const user = userEvent.setup();
    render(<ApplicationForm dict={ko.apply.form} locale="ko" />);
    await user.type(screen.getByLabelText("이름"), "김노까");
    await user.type(screen.getByLabelText("이메일"), "kim@example.com");
    await user.click(screen.getByRole("button", { name: "신청하기" }));

    expect(await screen.findByRole("heading", { name: "사용 신청이 접수되었습니다" })).toHaveFocus();
    expect(screen.getByText(ko.apply.form.doneBody)).toBeInTheDocument();
    expect(screen.getByText(ko.apply.form.doneExisting)).not.toHaveAttribute("lang");
    expect(document.querySelector("[lang]")).toBeNull();
    expect(screen.getByRole("link", { name: "업데이트 등록 방법 보기" })).toHaveAttribute(
      "href",
      "/ko/updates"
    );
  });

  it("sends one request when the button is pressed again while sending", async () => {
    let finish: (value: unknown) => void = () => {};
    fetchMock.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const user = await fillAndSubmit("Kim", "kim@example.com");

    const button = screen.getByRole("button", { name: form.submitting });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("status")).toHaveTextContent(form.submitting);
    await user.click(button);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    finish(reply(200, { ok: true }));
    expect(await screen.findByRole("heading", { name: form.doneHeading })).toBeInTheDocument();
  });

  it("keeps the entries and lets you retry when the server can't confirm storing them", async () => {
    fetchMock.mockResolvedValueOnce(reply(503, { ok: false, code: "UNAVAILABLE" }));
    const user = await fillAndSubmit("Kim", "kim@example.com");

    expect(await screen.findByRole("alert")).toHaveTextContent(form.errors.unconfirmed);
    expect(screen.queryByRole("heading", { name: form.doneHeading })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: form.doneLink })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Kim");
    expect(screen.getByLabelText("Email")).toHaveValue("kim@example.com");

    fetchMock.mockResolvedValueOnce(reply(200, { ok: true }));
    await user.click(screen.getByRole("button", { name: form.submit }));
    expect(await screen.findByRole("heading", { name: form.doneHeading })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("treats network errors, unreadable bodies and other 2xx statuses as unconfirmed", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const user = await fillAndSubmit("Kim", "kim@example.com");
    expect(await screen.findByRole("alert")).toHaveTextContent(form.errors.unconfirmed);

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token <");
      },
    });
    await user.click(screen.getByRole("button", { name: form.submit }));

    fetchMock.mockResolvedValueOnce(reply(201, { ok: true }));
    await user.click(screen.getByRole("button", { name: form.submit }));

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(await screen.findByRole("alert")).toHaveTextContent(form.errors.unconfirmed);
    expect(screen.queryByRole("heading", { name: form.doneHeading })).not.toBeInTheDocument();
  });

  it("says it couldn't confirm the request when the server doesn't answer in time", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError"))
          );
        })
    );
    await fillAndSubmit("Kim", "kim@example.com", { advanceTimers: vi.advanceTimersByTime });

    await vi.advanceTimersByTimeAsync(20_000);
    expect(await screen.findByRole("alert")).toHaveTextContent(form.errors.unconfirmed);
    expect(screen.queryByRole("heading", { name: form.doneHeading })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveValue("kim@example.com");
    expect(screen.getByRole("button", { name: form.submit })).not.toHaveAttribute("aria-disabled", "true");
  });

  it("maps rejected requests to their own messages", async () => {
    fetchMock.mockResolvedValueOnce(reply(429, { ok: false, code: "RATE_LIMITED" }));
    const user = await fillAndSubmit("Kim", "kim@example.com");
    expect(await screen.findByRole("alert")).toHaveTextContent(form.errors.rateLimited);

    fetchMock.mockResolvedValueOnce(reply(403, { ok: false, code: "FORBIDDEN" }));
    await user.click(screen.getByRole("button", { name: form.submit }));
    expect(await screen.findByText(form.errors.rejected)).toBeInTheDocument();

    fetchMock.mockResolvedValueOnce(reply(413, { ok: false, code: "PAYLOAD_TOO_LARGE" }));
    await user.click(screen.getByRole("button", { name: form.submit }));
    expect(await screen.findByText(form.errors.tooLarge)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("shows the server's field errors next to the field", async () => {
    fetchMock.mockResolvedValue(
      reply(400, { ok: false, code: "VALIDATION_ERROR", fieldErrors: { email: "INVALID" } })
    );
    await fillAndSubmit("Kim", "kim@example.com");

    const email = screen.getByLabelText("Email");
    await vi.waitFor(() => expect(email).toHaveFocus());
    expect(email).toHaveAccessibleDescription(form.errors.emailInvalid);
    expect(screen.getByLabelText("Name")).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says it couldn't confirm when a validation error names no field it recognises", async () => {
    fetchMock.mockResolvedValueOnce(reply(400, { ok: false, code: "VALIDATION_ERROR", fieldErrors: {} }));
    const user = await fillAndSubmit("Kim", "kim@example.com");
    expect(await screen.findByRole("alert")).toHaveTextContent(form.errors.unconfirmed);

    fetchMock.mockResolvedValueOnce(
      reply(400, {
        ok: false,
        code: "VALIDATION_ERROR",
        fieldErrors: { phone: "INVALID", email: "WRONG" },
      })
    );
    await user.click(screen.getByRole("button", { name: form.submit }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await screen.findByRole("alert")).toHaveTextContent(form.errors.unconfirmed);
    expect(screen.getByLabelText("Email")).not.toHaveAttribute("aria-invalid");
    expect(screen.getByLabelText("Email")).toHaveValue("kim@example.com");
  });
});
