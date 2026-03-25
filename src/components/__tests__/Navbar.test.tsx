import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import Navbar from "../Navbar";

const dict = {
  features: "Features",
  download: "Download",
};

describe("Navbar", () => {
  it('renders "Nokka" wordmark', () => {
    render(<Navbar dict={dict} locale="en" />);
    expect(screen.getByText("Nokka")).toBeInTheDocument();
  });

  it("has navigation links: Features, Download", () => {
    render(<Navbar dict={dict} locale="en" />);
    expect(screen.getByRole("link", { name: "Features" })).toBeInTheDocument();
    const downloadLinks = screen.getAllByRole("link", { name: /download/i });
    expect(downloadLinks.length).toBeGreaterThanOrEqual(1);
  });

  it("has download CTA link", () => {
    render(<Navbar dict={dict} locale="en" />);
    const ctaLinks = screen.getAllByRole("link", { name: /download/i });
    expect(ctaLinks.length).toBeGreaterThanOrEqual(1);
  });

  it("nav is fixed position with backdrop blur", () => {
    render(<Navbar dict={dict} locale="en" />);
    const nav = screen.getByRole("navigation");
    expect(nav).toHaveClass("fixed");
    expect(nav.className).toMatch(/backdrop-blur/);
  });

  it("links have correct href anchors", () => {
    render(<Navbar dict={dict} locale="en" />);
    expect(screen.getByRole("link", { name: "Features" })).toHaveAttribute(
      "href",
      "#features"
    );
    const downloadLinks = screen.getAllByRole("link", { name: /download/i });
    const downloadAnchor = downloadLinks.find(
      (link) => link.getAttribute("href") === "#download"
    );
    expect(downloadAnchor).toBeDefined();
  });

  it("shows language switcher with link to Korean", () => {
    render(<Navbar dict={dict} locale="en" />);
    expect(screen.getByText("EN")).toBeInTheDocument();
    const koLink = screen.getByRole("link", { name: "한국어" });
    expect(koLink).toHaveAttribute("href", "/ko");
  });
});
