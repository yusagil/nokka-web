import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, it, expect, vi } from "vitest";
import InboxError from "@/app/admin/applications/error";
import Loading from "@/app/admin/applications/loading";
import ApplicationsPage, { metadata } from "@/app/admin/applications/page";
import { copy } from "../copy";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("/admin/applications", () => {
  it("is kept out of search engines and sends no referrer", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.referrer).toBe("no-referrer");
  });

  it("renders the inbox, which asks the API for the list", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, items: [], nextCursor: null }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ApplicationsPage />);
    expect(screen.getByRole("heading", { level: 1, name: copy.title })).toBeInTheDocument();
    expect(await screen.findByText(copy.empty)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("announces loading", () => {
    render(<Loading />);
    expect(screen.getByRole("status")).toHaveTextContent(copy.pageLoading);
  });

  it("offers a retry when the page fails, without showing the error", async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    render(<InboxError unstable_retry={retry} />);
    expect(screen.getByRole("alert")).toHaveTextContent(copy.pageFailed);
    await user.click(screen.getByRole("button", { name: copy.retry }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
