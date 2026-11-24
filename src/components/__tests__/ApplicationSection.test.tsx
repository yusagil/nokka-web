import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import en from "@/dictionaries/en.json";
import ko from "@/dictionaries/ko.json";
import ApplicationSection from "../ApplicationSection";

describe("ApplicationSection", () => {
  it("is the #apply section with a heading", () => {
    const { container } = render(<ApplicationSection dict={en.apply} locale="en" />);
    expect(container.querySelector("section#apply")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: en.apply.heading })
    ).toBeInTheDocument();
  });

  it("renders the Korean form", () => {
    render(<ApplicationSection dict={ko.apply} locale="ko" />);
    expect(screen.getByRole("heading", { level: 2, name: "사용 신청하기" })).toBeInTheDocument();
    expect(screen.getByLabelText("이름")).toBeInTheDocument();
    expect(screen.getByLabelText("이메일")).toBeInTheDocument();
    expect(
      screen.getByText("신청 검토와 설치·업데이트 안내를 위해 이름과 이메일을 받습니다.")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "신청하기" })).toBeInTheDocument();
  });

  it.each([
    ["en", en.apply],
    ["ko", ko.apply],
  ] as const)("lists review, the emailed install link, then the in-app code, before the form (%s)", (locale, dict) => {
    const { container } = render(<ApplicationSection dict={dict} locale={locale} />);
    const steps = screen.getByRole("list", { name: dict.stepsHeading });
    expect(
      Array.from(steps.querySelectorAll("li"), (li) => li.textContent)
    ).toEqual(dict.steps);
    expect(
      steps.compareDocumentPosition(container.querySelector("form")!) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("puts the steps in that order in both languages", () => {
    expect(en.apply.steps[0]).toMatch(/reviews/);
    expect(en.apply.steps[1]).toMatch(/approved.*install link/);
    expect(en.apply.steps[2]).toMatch(/After installing.*registration code in the app/);
    expect(ko.apply.steps[0]).toMatch(/검토/);
    expect(ko.apply.steps[1]).toMatch(/승인되면.*설치 링크/);
    expect(ko.apply.steps[2]).toMatch(/설치한 뒤.*앱에서.*등록 코드/);
  });

  it("says nothing about a one-time install link until the server enforces it", () => {
    const copy = JSON.stringify([en.apply, ko.apply]);
    expect(copy).not.toMatch(/one-time|single-use|\bonce\b|한 번만|1회|일회/i);
  });

  it("points people who already use Nokka to the app's update check in both languages", () => {
    expect(en.apply.form.doneExisting).toMatch(/Already using Nokka\?.*‘업데이트 확인…’ \(Check for Updates\)/);
    expect(ko.apply.form.doneExisting).toMatch(/이미 Nokka를 쓰고 있다면.*‘업데이트 확인…’/);
  });
});
