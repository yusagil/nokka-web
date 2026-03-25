import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import Footer from "../Footer";

const dict = {
  copyright: "\u00a9 2026",
  releaseNotes: "Release Notes",
  contact: "Contact",
};

describe("Footer", () => {
  it('renders "Nokka" wordmark and copyright', () => {
    render(<Footer dict={dict} locale="en" />);
    expect(screen.getByText("Nokka")).toBeInTheDocument();
    expect(screen.getByText(/© 2026/)).toBeInTheDocument();
  });

  it("has links: Release Notes, Contact", () => {
    render(<Footer dict={dict} locale="en" />);
    expect(
      screen.getByRole("link", { name: "Release Notes" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Contact" })
    ).toBeInTheDocument();
  });

  it("has top border", () => {
    render(<Footer dict={dict} locale="en" />);
    const footer = screen.getByRole("contentinfo");
    expect(footer.className).toMatch(/border-t/);
  });
});
