import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import Comparison from "../Comparison";

const dict = {
  heading: "You\u2019ve tried the others.",
  items: {
    loom: {
      name: "vs. Loom",
      description:
        "Loom is great for sharing recordings with a team. But it requires an account, uploads everything to the cloud, and you can\u2019t pause mid-recording. If you want local files and more recording control, Nokka is simpler.",
    },
    obs: {
      name: "vs. OBS",
      description:
        "OBS is a professional broadcasting tool. It can do almost anything \u2014 if you\u2019re willing to learn it. For quick screen recordings on your Mac, it\u2019s like driving a semi truck to the grocery store.",
    },
    quicktime: {
      name: "vs. QuickTime",
      description:
        "QuickTime is built in and free. But it can\u2019t record system audio without workarounds, doesn\u2019t support region selection, and the controls are buried in File menus. It works until it doesn\u2019t.",
    },
    builtIn: {
      name: "vs. macOS Built-in (\u2318\u21e75)",
      description:
        "The built-in toolbar is convenient but limited. No system audio capture, basic controls, no pause/resume. Fine for a quick screenshot. Not enough for real recording work.",
    },
  },
};

describe("Comparison", () => {
  it('renders heading "You\'ve tried the others."', () => {
    render(<Comparison dict={dict} />);
    expect(
      screen.getByRole("heading", { name: /you.ve tried the others/i })
    ).toBeInTheDocument();
  });

  it("shows comparisons for Loom, OBS, QuickTime, macOS Built-in", () => {
    render(<Comparison dict={dict} />);
    expect(screen.getByText(/vs\. Loom/)).toBeInTheDocument();
    expect(screen.getByText(/vs\. OBS/)).toBeInTheDocument();
    expect(screen.getByText(/vs\. QuickTime/)).toBeInTheDocument();
    expect(screen.getByText(/vs\. macOS Built-in/)).toBeInTheDocument();
  });

  it("each comparison has the competitor name and description", () => {
    render(<Comparison dict={dict} />);
    // Loom
    expect(
      screen.getByText(/Loom is great for sharing recordings with a team/i)
    ).toBeInTheDocument();
    // OBS
    expect(
      screen.getByText(/OBS is a professional broadcasting tool/i)
    ).toBeInTheDocument();
    // QuickTime
    expect(
      screen.getByText(/QuickTime is built in and free/i)
    ).toBeInTheDocument();
    // macOS Built-in
    expect(
      screen.getByText(/the built-in toolbar is convenient but limited/i)
    ).toBeInTheDocument();
  });
});
