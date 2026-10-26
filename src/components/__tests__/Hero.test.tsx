import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import en from "@/dictionaries/en.json";
import ko from "@/dictionaries/ko.json";
import { DOWNLOAD_URL } from "@/lib/links";
import Hero from "../Hero";

// The headline has a deliberate line break; compare with whitespace collapsed.
const sameText = (expected: string) => (name: string) =>
  name.replace(/\s+/g, " ") === expected.replace(/\s+/g, " ");

describe("Hero", () => {
  it("renders the headline as the page h1", () => {
    render(<Hero dict={en.hero} />);
    expect(
      screen.getByRole("heading", { level: 1, name: sameText(en.hero.headline) })
    ).toBeInTheDocument();
  });

  it("positions Nokka as a meeting recorder", () => {
    render(<Hero dict={en.hero} />);
    expect(screen.getByText("Meeting recorder for Mac")).toBeInTheDocument();
    expect(screen.getByText(/transcribes and separates speakers on your Mac/)).toBeInTheDocument();
  });

  it("download link points at the latest release DMG and names the file type", () => {
    render(<Hero dict={en.hero} />);
    const link = screen.getByRole("link", { name: /download for macos/i });
    expect(link).toHaveAttribute("href", DOWNLOAD_URL);
    expect(link).toHaveAccessibleName(/DMG/);
  });

  it("lists macOS 14 and Apple silicon, without Intel", () => {
    render(<Hero dict={en.hero} />);
    expect(screen.getByText("macOS 14 or later")).toBeInTheDocument();
    expect(screen.getByText("Apple silicon only")).toBeInTheDocument();
    expect(screen.queryByText(/intel/i)).not.toBeInTheDocument();
  });

  it("shows the live transcript screenshot with descriptive alt text and a caption", () => {
    render(<Hero dict={en.hero} />);
    const img = screen.getByRole("img", { name: /live transcript window/i });
    expect(img).toHaveAttribute("src", expect.stringContaining("live-transcript.png"));
    expect(screen.getByText(/Sample conversation/)).toBeInTheDocument();
  });

  it("renders the Korean copy", () => {
    render(<Hero dict={ko.hero} />);
    expect(
      screen.getByRole("heading", { level: 1, name: sameText(ko.hero.headline) })
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /macOS용 다운로드/ })).toHaveAttribute(
      "href",
      DOWNLOAD_URL
    );
  });
});
