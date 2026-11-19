import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import en from "@/dictionaries/en.json";
import ko from "@/dictionaries/ko.json";
import ApplicationSection from "../ApplicationSection";

describe("ApplicationSection", () => {
  it("is the #apply section with a heading", () => {
    const { container } = render(<ApplicationSection dict={en.apply} />);
    expect(container.querySelector("section#apply")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: en.apply.heading })
    ).toBeInTheDocument();
  });

  it("renders the Korean form", () => {
    render(<ApplicationSection dict={ko.apply} />);
    expect(screen.getByRole("heading", { level: 2, name: "사용 신청하기" })).toBeInTheDocument();
    expect(screen.getByLabelText("이름")).toBeInTheDocument();
    expect(screen.getByLabelText("이메일")).toBeInTheDocument();
    expect(
      screen.getByText("사용 신청 접수와 안내를 위해 이름과 이메일을 받습니다.")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "신청하기" })).toBeInTheDocument();
  });
});
