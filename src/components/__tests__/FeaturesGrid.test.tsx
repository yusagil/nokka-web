import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import FeaturesGrid from "../FeaturesGrid";

const dict = {
  heading: "Everything you need. Nothing you don\u2019t.",
  features: {
    systemAudio: {
      title: "System Audio + Mic",
      description:
        "Capture system sound and your microphone on separate tracks. Record what you hear and what you say.",
    },
    pauseResume: {
      title: "Pause & Resume",
      description:
        "Life interrupts. Pause your recording, handle it, pick up exactly where you left off.",
    },
    globalShortcuts: {
      title: "Global Shortcuts",
      description:
        "\u2318\u21e7R to record. \u2318\u21e7P to pause. \u2318\u21e7M for mic. Works from anywhere, no window switching.",
    },
    menuBarApp: {
      title: "Menu Bar App",
      description:
        "Lives in your menu bar. Click to start. No dock icon, no window clutter, no setup ritual.",
    },
    floatingControlBar: {
      title: "Floating Control Bar",
      description:
        "A minimal pill-shaped bar stays visible during recording. Minimizable when you don\u2019t need it.",
    },
    countdownTimer: {
      title: "Countdown Timer",
      description:
        "Configurable countdown before recording starts. Enough time to switch to the right app.",
    },
    h264: {
      title: "H.264 Hardware Acceleration",
      description:
        "Hardware-accelerated MP4 encoding. Smooth recording without taxing your CPU.",
    },
    macosNative: {
      title: "macOS Native",
      description:
        "Built with SwiftUI and ScreenCaptureKit. No Electron, no web wrapper. Feels like it belongs on your Mac.",
    },
  },
};

describe("FeaturesGrid", () => {
  it('section has id="features"', () => {
    render(<FeaturesGrid dict={dict} />);
    const section = document.getElementById("features");
    expect(section).toBeInTheDocument();
  });

  it('renders heading "Everything you need. Nothing you don\'t."', () => {
    render(<FeaturesGrid dict={dict} />);
    const heading = screen.getByRole("heading", {
      name: /everything you need/i,
    });
    expect(heading).toBeInTheDocument();
  });

  it("renders 8 feature cards", () => {
    render(<FeaturesGrid dict={dict} />);
    const titles = [
      "System Audio + Mic",
      "Pause & Resume",
      "Global Shortcuts",
      "Menu Bar App",
      "Floating Control Bar",
      "Countdown Timer",
      "H.264 Hardware Acceleration",
      "macOS Native",
    ];
    titles.forEach((title) => {
      expect(screen.getByText(title)).toBeInTheDocument();
    });
  });

  it("each card has an SVG icon", () => {
    render(<FeaturesGrid dict={dict} />);
    const svgs = document.querySelectorAll("svg");
    expect(svgs.length).toBeGreaterThanOrEqual(8);
  });

  it("each card has a description", () => {
    render(<FeaturesGrid dict={dict} />);
    expect(
      screen.getByText(/capture system sound and your microphone/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/life interrupts/i)).toBeInTheDocument();
    expect(screen.getByText(/⌘⇧R to record/i)).toBeInTheDocument();
    expect(
      screen.getByText(/lives in your menu bar/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/minimal pill-shaped bar/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/configurable countdown/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/hardware-accelerated mp4 encoding/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/built with swiftui and screencapturekit/i)
    ).toBeInTheDocument();
  });
});
