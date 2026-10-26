import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import en from "@/dictionaries/en.json";
import FeaturesGrid from "../FeaturesGrid";

describe("FeaturesGrid", () => {
  it("renders the section heading", () => {
    render(<FeaturesGrid dict={en.features} />);
    expect(
      screen.getByRole("heading", { level: 2, name: en.features.heading })
    ).toBeInTheDocument();
  });

  it("renders every feature card with a title and description", () => {
    render(<FeaturesGrid dict={en.features} />);
    const items = Object.values(en.features.items);
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(items.length);
    for (const item of items) {
      expect(screen.getByRole("heading", { level: 3, name: item.title })).toBeInTheDocument();
      expect(screen.getByText(item.description)).toBeInTheDocument();
    }
  });

  it("lists the default shortcuts", () => {
    render(<FeaturesGrid dict={en.features} />);
    expect(screen.getByText(/⌘⇧R record, ⌘⇧P pause, ⌘⇧M mic, ⌘⇧B bookmark/)).toBeInTheDocument();
  });
});
