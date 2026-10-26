import { render, screen, within } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import en from "@/dictionaries/en.json";
import ko from "@/dictionaries/ko.json";
import Navbar from "../Navbar";

describe("Navbar", () => {
  it('renders the "Nokka" wordmark linking home', () => {
    render(<Navbar dict={en.nav} locale="en" />);
    expect(screen.getByRole("link", { name: "Nokka" })).toHaveAttribute("href", "/en");
  });

  it("links to the page sections", () => {
    render(<Navbar dict={en.nav} locale="en" />);
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "How it works" })).toHaveAttribute("href", "#how");
    expect(within(nav).getByRole("link", { name: "Data paths" })).toHaveAttribute("href", "#privacy");
    expect(within(nav).getByRole("link", { name: "Requirements" })).toHaveAttribute(
      "href",
      "#requirements"
    );
    expect(within(nav).getByRole("link", { name: "Download" })).toHaveAttribute("href", "#download");
  });

  it("is fixed with a backdrop blur", () => {
    render(<Navbar dict={en.nav} locale="en" />);
    const header = screen.getByRole("banner");
    expect(header).toHaveClass("fixed");
    expect(header.className).toMatch(/backdrop-blur/);
  });

  it("switches language from English to Korean", () => {
    render(<Navbar dict={en.nav} locale="en" />);
    const group = screen.getByRole("group", { name: "Language" });
    expect(within(group).getByText("EN")).toHaveAttribute("aria-current", "true");
    const koLink = within(group).getByRole("link", { name: "한국어" });
    expect(koLink).toHaveAttribute("href", "/ko");
    expect(koLink).toHaveAttribute("lang", "ko");
  });

  it("switches language from Korean to English", () => {
    render(<Navbar dict={ko.nav} locale="ko" />);
    const group = screen.getByRole("group", { name: "언어 선택" });
    expect(within(group).getByRole("link", { name: "EN" })).toHaveAttribute("href", "/en");
    expect(screen.getByRole("link", { name: "데이터 경로" })).toHaveAttribute("href", "#privacy");
  });
});
