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
    expect(screen.getByRole("img", { name: /naming row has opened/i })).toHaveAttribute(
      "src",
      expect.stringContaining("speaker-naming.png")
    );
    expect(screen.getByText(/opens a naming row right below it/)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /floating bar/i })).toBeInTheDocument();
  });

  it("describes naming a speaker in the window in Korean", () => {
    render(<Workflow dict={ko.how} />);
    expect(screen.getByRole("img", { name: /이름 줄이 열려/ })).toBeInTheDocument();
    expect(screen.getByText(/창 안에 이름 줄이 열립니다/)).toBeInTheDocument();
  });

  it("says when audio and transcripts leave the Mac", () => {
    render(<Workflow dict={en.how} />);
    expect(screen.getByText(/Choose Deepgram or Soniox/)).toHaveTextContent(
      /Only then does audio go to that service, and speakers are still separated on your Mac by Nemotron 3/
    );
    expect(screen.getByText(/no audio is sent for this/)).toBeInTheDocument();
    expect(screen.getByText(/sends nothing until you press Send/)).toBeInTheDocument();
  });

  it("explains that this Mac takes over when a cloud engine drops", () => {
    render(<Workflow dict={en.how} />);
    const handover = screen.getByText(/takes over within 1–2 seconds/);
    expect(handover).toHaveTextContent(/returns to the cloud on its own/);
    expect(handover).toHaveTextContent(/same speaker numbers and names/);
    expect(handover).toHaveTextContent(/API key or balance shows an alert/);
  });

  it("asks only the questions it must, and offers quick minutes", () => {
    render(<Workflow dict={en.how} />);
    expect(screen.getByText(/at most 10 questions per recording, and sometimes none/)).toBeInTheDocument();
    expect(screen.getByText(/quick minutes straight from the transcript/)).toBeInTheDocument();
  });

  it("describes cloud engines and the handover in Korean", () => {
    render(<Workflow dict={ko.how} />);
    expect(screen.getByText(/Deepgram이나 Soniox를 고르면/)).toHaveTextContent(
      /화자는 그때도 이 Mac의 Nemotron 3가 나눕니다/
    );
    expect(screen.getByText(/1~2초 안에 이어 받아/)).toHaveTextContent(/화자 번호와 이름도 그대로 이어집니다/);
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
