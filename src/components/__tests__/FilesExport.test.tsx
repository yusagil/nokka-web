import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import en from "@/dictionaries/en.json";
import FilesExport from "../FilesExport";

describe("FilesExport", () => {
  it("is the #files section with a heading", () => {
    const { container } = render(<FilesExport dict={en.files} />);
    expect(container.querySelector("section#files")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: en.files.heading })).toBeInTheDocument();
  });

  it("shows the recording folder files", () => {
    render(<FilesExport dict={en.files} />);
    for (const name of ["transcript.json", "summary.md", "nokka.json"]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });

  it("lists every export format", () => {
    render(<FilesExport dict={en.files} />);
    for (const format of ["Markdown · Obsidian", "Word (.docx)", "PDF", "Hangul (.hwpx)", "Notion", "Slack"]) {
      expect(screen.getByText(format)).toBeInTheDocument();
    }
  });
});
