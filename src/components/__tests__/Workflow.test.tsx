import { render, screen, within } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import en from "@/dictionaries/en.json";
import ko from "@/dictionaries/ko.json";
import Workflow from "../Workflow";

describe("Workflow", () => {
  it("is the #how section with three ordered steps", () => {
    const { container } = render(<Workflow dict={en.how} />);
    expect(container.querySelector("section#how")).toBeInTheDocument();
    const steps = within(screen.getAllByRole("list")[0]).getAllByRole("heading", { level: 3 });
    expect(steps.map((h) => h.textContent)).toEqual([
      en.how.steps.record.title,
      en.how.steps.transcribe.title,
      en.how.steps.minutes.title,
    ]);
  });

  it("explains that recording does not wait for the model", () => {
    render(<Workflow dict={en.how} />);
    expect(screen.getByText(/doesn't wait for the transcription model/)).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: /transcription model needed/i })
    ).toHaveAttribute("src", expect.stringContaining("main-window-recording.png"));
  });

  it("shows speaker naming and the floating bar with alt text", () => {
    render(<Workflow dict={en.how} />);
    expect(screen.getByRole("img", { name: /speaker bar/i })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /floating bar/i })).toBeInTheDocument();
  });

  it("says when audio and transcripts leave the Mac", () => {
    render(<Workflow dict={en.how} />);
    expect(screen.getByText(/Only then does audio go to Deepgram/)).toBeInTheDocument();
    expect(screen.getByText(/sends nothing until you press Send/)).toBeInTheDocument();
  });

  it("marks the example minutes as Korean text and labels citation chips", () => {
    render(<Workflow dict={en.how} />);
    const decision = screen.getByText("예산은 다음 주에 확정함");
    expect(decision).toHaveAttribute("lang", "ko");
    expect(screen.getAllByText(/Time of the supporting line/)).toHaveLength(2);
    expect(screen.getByText(/The content is an example/)).toBeInTheDocument();
  });

  it("renders the Korean steps", () => {
    render(<Workflow dict={ko.how} />);
    expect(
      screen.getByRole("heading", { level: 3, name: ko.how.steps.minutes.title })
    ).toBeInTheDocument();
  });
});
