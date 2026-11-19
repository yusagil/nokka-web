import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import en from "@/dictionaries/en.json";
import { ISSUES_URL } from "@/lib/links";
import Footer from "../Footer";

describe("Footer", () => {
  it('renders "Nokka" and the copyright', () => {
    render(<Footer dict={en.footer} />);
    expect(screen.getByText("Nokka")).toBeInTheDocument();
    expect(screen.getByText(/© 2026/)).toBeInTheDocument();
  });

  it("does not link to GitHub Releases", () => {
    render(<Footer dict={en.footer} />);
    expect(screen.queryByRole("link", { name: /release/i })).not.toBeInTheDocument();
  });

  it("links contact to GitHub issues", () => {
    render(<Footer dict={en.footer} />);
    expect(screen.getByRole("link", { name: /contact/i })).toHaveAttribute("href", ISSUES_URL);
  });

  it("has a top border", () => {
    render(<Footer dict={en.footer} />);
    expect(screen.getByRole("contentinfo").className).toMatch(/border-t/);
  });
});
