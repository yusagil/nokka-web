import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import en from "@/dictionaries/en.json";
import ko from "@/dictionaries/ko.json";
import Requirements from "../Requirements";

describe("Requirements", () => {
  it("is the #requirements section", () => {
    const { container } = render(<Requirements dict={en.requirements} />);
    expect(container.querySelector("section#requirements")).toBeInTheDocument();
  });

  it("states macOS 14, Apple silicon only, and the Korean interface", () => {
    render(<Requirements dict={en.requirements} />);
    expect(screen.getByText("14 Sonoma or later")).toBeInTheDocument();
    expect(screen.getByText(/Intel Macs are not supported/)).toBeInTheDocument();
    expect(screen.getByText(/interface and minutes are in Korean/)).toBeInTheDocument();
  });

  it("lists the known limitations", () => {
    render(<Requirements dict={en.requirements} />);
    expect(screen.getByRole("heading", { level: 3, name: "Known limitations" })).toBeInTheDocument();
    for (const limit of en.requirements.limits) {
      expect(screen.getByText(limit)).toBeInTheDocument();
    }
  });

  it("renders the Korean requirements", () => {
    render(<Requirements dict={ko.requirements} />);
    expect(screen.getByRole("heading", { level: 3, name: "알려진 한계" })).toBeInTheDocument();
    expect(screen.getByText(/Intel Mac은 지원하지 않습니다/)).toBeInTheDocument();
  });
});
