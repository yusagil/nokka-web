import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import TrustBadges from "../TrustBadges";

const dict = {
  badges: ["Built with Swift", "~5 MB", "Zero Analytics", "100% Local"],
};

describe("TrustBadges", () => {
  it("renders trust badges with correct text", () => {
    render(<TrustBadges dict={dict} />);
    expect(screen.getByText("Built with Swift")).toBeInTheDocument();
    expect(screen.getByText("~5 MB")).toBeInTheDocument();
    expect(screen.getByText("Zero Analytics")).toBeInTheDocument();
    expect(screen.getByText("100% Local")).toBeInTheDocument();
  });

  it("badges include privacy statement", () => {
    render(<TrustBadges dict={dict} />);
    expect(screen.getByText("Zero Analytics")).toBeInTheDocument();
    expect(screen.getByText("100% Local")).toBeInTheDocument();
  });
});
