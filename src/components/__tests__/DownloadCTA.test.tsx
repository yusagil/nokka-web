import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import DownloadCTA from "../DownloadCTA";

const dict = {
  heading: "Ready to record?",
  subheading: "Download Nokka and start recording in seconds.",
  cta: "Download for macOS",
  requirements: "macOS 14 Sonoma or later \u00b7 Apple Silicon & Intel \u00b7 ~5 MB",
};

describe("DownloadCTA", () => {
  it('has id="download"', () => {
    const { container } = render(<DownloadCTA dict={dict} />);
    expect(container.querySelector("#download")).toBeInTheDocument();
  });

  it('renders heading "Ready to record?"', () => {
    render(<DownloadCTA dict={dict} />);
    expect(
      screen.getByRole("heading", { name: /ready to record\?/i })
    ).toBeInTheDocument();
  });

  it('has download button with text "Download for macOS"', () => {
    render(<DownloadCTA dict={dict} />);
    expect(
      screen.getByRole("link", { name: /download for macos/i })
    ).toBeInTheDocument();
  });

  it("shows system requirements", () => {
    render(<DownloadCTA dict={dict} />);
    expect(screen.getByText(/macOS 14 Sonoma or later/i)).toBeInTheDocument();
    expect(screen.getByText(/Apple Silicon & Intel/i)).toBeInTheDocument();
  });
});
