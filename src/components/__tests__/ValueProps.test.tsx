import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import ValueProps from "../ValueProps";

const dict = {
  heading: "Why Nokka",
  ownIt: {
    title: "Own It",
    description:
      "Every recording saves directly to your Mac as an MP4. No cloud uploads, no account required, no platform that can revoke access. You participated in it \u2014 you should own it.",
  },
  controlIt: {
    title: "Control It",
    description:
      "Choose your recording mode: the full screen, a specific window, or drag to select any region. Record what you intend to. Nothing more.",
  },
  forgetIt: {
    title: "Forget It",
    description:
      "Nokka records in the background with a minimal floating bar. Switch apps, browse docs, write code \u2014 the recording captures exactly what you told it to, while you do everything else.",
  },
};

describe("ValueProps", () => {
  it("renders section with id for navigation", () => {
    render(<ValueProps dict={dict} />);
    const section = document.getElementById("value-props");
    expect(section).toBeInTheDocument();
  });

  it('renders 3 cards with correct titles: "Own It", "Control It", "Forget It"', () => {
    render(<ValueProps dict={dict} />);
    expect(screen.getByText("Own It")).toBeInTheDocument();
    expect(screen.getByText("Control It")).toBeInTheDocument();
    expect(screen.getByText("Forget It")).toBeInTheDocument();
  });

  it("each card has description text", () => {
    render(<ValueProps dict={dict} />);
    expect(
      screen.getByText(/every recording saves directly to your mac/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/choose your recording mode/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/nokka records in the background/i)
    ).toBeInTheDocument();
  });

  it("each card has an SVG icon", () => {
    render(<ValueProps dict={dict} />);
    const svgs = document.querySelectorAll("svg");
    expect(svgs.length).toBeGreaterThanOrEqual(3);
  });

  it("renders section heading", () => {
    render(<ValueProps dict={dict} />);
    const heading = screen.getByRole("heading", { name: /why nokka/i });
    expect(heading).toBeInTheDocument();
  });
});
