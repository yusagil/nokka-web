import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import en from "@/dictionaries/en.json";
import ko from "@/dictionaries/ko.json";
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

  it("links only to the how-it-works section, with no download link", () => {
    render(<Hero dict={en.hero} />);
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByRole("link", { name: /see how it works/i })).toHaveAttribute("href", "#how");
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
    expect(img).toHaveAttribute("src", expect.stringContaining("live-window.png"));
    expect(img).toHaveAccessibleName(expect.stringMatching(/pencil icons/));
    expect(screen.getByText(/click a speaker to name them/)).toBeInTheDocument();
    expect(screen.getByText(/Sample conversation/)).toBeInTheDocument();
  });

  it("renders the Korean copy", () => {
    render(<Hero dict={ko.hero} />);
    expect(
      screen.getByRole("heading", { level: 1, name: sameText(ko.hero.headline) })
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /어떻게 쓰는지 보기/ })).toHaveAttribute("href", "#how");
    expect(screen.queryByText(/다운로드|DMG/)).not.toBeInTheDocument();
  });
});
