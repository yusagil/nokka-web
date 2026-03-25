import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect } from "vitest";
import FeatureShowcase from "../FeatureShowcase";

const dict = {
  heading: "Three ways to record",
  tablistLabel: "Recording modes",
  screenshotPrefix: "Screenshot",
  tabs: {
    fullScreen: {
      label: "Full Screen",
      title: "Everything. All of it.",
      description:
        "One click captures your entire display at full resolution. The simplest way to record \u2014 no decisions, no setup. Just your screen, exactly as you see it.",
      bullets: [
        "Captures at native display resolution",
        "\u2318\u21e7R to start instantly",
      ],
    },
    regionSelect: {
      label: "Region Select",
      title: "Draw a rectangle. Record what\u2019s inside.",
      description:
        "Click and drag to define your recording area. Resize with handles, see dimensions in real-time. Perfect for tutorials, specific app sections, or social media dimensions.",
      bullets: [
        "Interactive resize handles",
        "Real-time size display (W \u00d7 H px)",
        "Minimum 200\u00d7150 pixels",
      ],
    },
    windowCapture: {
      label: "Window Capture",
      title: "Pick a window. Any window.",
      description:
        "Select a specific application window from a visual grid \u2014 even if it\u2019s in another Space or running fullscreen. Record that app while you work in another.",
      bullets: [
        "Works across Spaces and fullscreen apps",
        "Automatic system UI filtering",
        "Live window thumbnails",
      ],
    },
  },
};

describe("FeatureShowcase", () => {
  it('renders heading "Three ways to record"', () => {
    render(<FeatureShowcase dict={dict} />);
    expect(
      screen.getByRole("heading", { name: /three ways to record/i })
    ).toBeInTheDocument();
  });

  it("has 3 tabs: Full Screen, Region Select, Window Capture", () => {
    render(<FeatureShowcase dict={dict} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    expect(screen.getByRole("tab", { name: /full screen/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /region select/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /window capture/i })).toBeInTheDocument();
  });

  it('default active tab is "Full Screen"', () => {
    render(<FeatureShowcase dict={dict} />);
    const fullScreenTab = screen.getByRole("tab", { name: /full screen/i });
    expect(fullScreenTab).toHaveAttribute("aria-selected", "true");
  });

  it("clicking a tab changes the displayed content", async () => {
    const user = userEvent.setup();
    render(<FeatureShowcase dict={dict} />);

    // Default: Full Screen content visible
    expect(screen.getByText(/everything\. all of it\./i)).toBeInTheDocument();

    // Click Region Select
    await user.click(screen.getByRole("tab", { name: /region select/i }));
    expect(
      screen.getByText(/draw a rectangle\. record what.s inside\./i)
    ).toBeInTheDocument();

    // Click Window Capture
    await user.click(screen.getByRole("tab", { name: /window capture/i }));
    expect(
      screen.getByText(/pick a window\. any window\./i)
    ).toBeInTheDocument();
  });

  it("each tab panel has title and description", async () => {
    const user = userEvent.setup();
    render(<FeatureShowcase dict={dict} />);

    // Full Screen
    expect(screen.getByText(/everything\. all of it\./i)).toBeInTheDocument();
    expect(
      screen.getByText(/one click captures your entire display/i)
    ).toBeInTheDocument();

    // Region Select
    await user.click(screen.getByRole("tab", { name: /region select/i }));
    expect(
      screen.getByText(/draw a rectangle\. record what.s inside\./i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/click and drag to define your recording area/i)
    ).toBeInTheDocument();

    // Window Capture
    await user.click(screen.getByRole("tab", { name: /window capture/i }));
    expect(
      screen.getByText(/pick a window\. any window\./i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/select a specific application window/i)
    ).toBeInTheDocument();
  });

  it("tabs have proper ARIA roles (tablist, tab, tabpanel)", () => {
    render(<FeatureShowcase dict={dict} />);
    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(3);
    expect(screen.getByRole("tabpanel")).toBeInTheDocument();
  });
});
