import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import en from "@/dictionaries/en.json";
import { DOWNLOAD_URL, LATEST_RELEASE_URL } from "@/lib/links";
import DownloadCTA from "../DownloadCTA";

describe("DownloadCTA", () => {
  it("is the #download section with a heading", () => {
    const { container } = render(<DownloadCTA dict={en.downloadCta} />);
    expect(container.querySelector("section#download")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: en.downloadCta.heading })
    ).toBeInTheDocument();
  });

  it("download button points at the latest release DMG", () => {
    render(<DownloadCTA dict={en.downloadCta} />);
    expect(screen.getByRole("link", { name: /download for macos/i })).toHaveAttribute(
      "href",
      DOWNLOAD_URL
    );
  });

  it("shows requirements and links to the release notes for the checksum", () => {
    render(<DownloadCTA dict={en.downloadCta} />);
    expect(screen.getByText("macOS 14 or later")).toBeInTheDocument();
    expect(screen.getByText("Apple silicon")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /release notes and sha-256/i })).toHaveAttribute(
      "href",
      LATEST_RELEASE_URL
    );
  });
});
