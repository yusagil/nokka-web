import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import Hero from "../Hero";

const dict = {
  headline: "Your screen. Your recording. Your Mac.",
  subheadline:
    "A free, native macOS screen recorder. Capture your full screen, a window, or any region \u2014 with system audio. Local files, no account, no cloud.",
  cta: "Download for macOS",
  requirements: "Free \u00b7 macOS 14+ \u00b7 Apple Silicon & Intel",
  screenshotAlt: "Nokka hero screenshot",
};

describe("Hero", () => {
  it("renders headline", () => {
    render(<Hero dict={dict} />);
    expect(
      screen.getByRole("heading", {
        name: "Your screen. Your recording. Your Mac.",
      })
    ).toBeInTheDocument();
  });

  it("renders subheadline with key phrases", () => {
    render(<Hero dict={dict} />);
    const subheadline = screen.getByText(/screen recorder/i);
    expect(subheadline).toBeInTheDocument();
  });

  it('has download CTA button with correct text "Download for macOS"', () => {
    render(<Hero dict={dict} />);
    expect(
      screen.getByRole("link", { name: /download for macos/i })
    ).toBeInTheDocument();
  });

  it("has system requirements text", () => {
    render(<Hero dict={dict} />);
    expect(screen.getByText(/macOS 14\+/)).toBeInTheDocument();
    expect(screen.getByText(/Apple Silicon/i)).toBeInTheDocument();
  });

  it("has hero screenshot image", () => {
    render(<Hero dict={dict} />);
    expect(screen.getByRole("img", { name: /hero/i })).toBeInTheDocument();
  });
});
