"use client";

import { useState } from "react";

interface TabDict {
  label: string;
  title: string;
  description: string;
  bullets: string[];
}

interface FeatureShowcaseProps {
  dict: {
    heading: string;
    tablistLabel: string;
    screenshotPrefix: string;
    tabs: {
      fullScreen: TabDict;
      regionSelect: TabDict;
      windowCapture: TabDict;
    };
  };
}

export default function FeatureShowcase({ dict }: FeatureShowcaseProps) {
  const tabs = [
    { id: "full-screen", ...dict.tabs.fullScreen },
    { id: "region-select", ...dict.tabs.regionSelect },
    { id: "window-capture", ...dict.tabs.windowCapture },
  ];

  const [activeIndex, setActiveIndex] = useState(0);
  const active = tabs[activeIndex];

  return (
    <section className="py-20 px-4">
      <div className="mx-auto max-w-[1120px]">
        <h2 className="text-center text-3xl font-bold text-[--color-text-primary] mb-12">
          {dict.heading}
        </h2>

        {/* Tab bar */}
        <div
          role="tablist"
          aria-label={dict.tablistLabel}
          className="mx-auto mb-12 flex w-fit rounded-full border border-[--color-border-default] bg-[--color-bg-secondary] p-1"
        >
          {tabs.map((tab, i) => (
            <button
              key={tab.id}
              role="tab"
              id={`tab-${tab.id}`}
              aria-selected={i === activeIndex}
              aria-controls={`panel-${tab.id}`}
              onClick={() => setActiveIndex(i)}
              className={`h-10 cursor-pointer rounded-full px-5 text-sm font-medium transition-all duration-150 ease-out ${
                i === activeIndex
                  ? "bg-[--color-bg-tertiary] text-[--color-text-primary]"
                  : "text-[--color-text-secondary] hover:text-[--color-text-primary]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div
          role="tabpanel"
          id={`panel-${active.id}`}
          aria-labelledby={`tab-${active.id}`}
          className="flex flex-col gap-8 lg:flex-row lg:items-center lg:gap-12"
        >
          {/* Screenshot placeholder */}
          <div className="flex aspect-video w-full items-center justify-center rounded-xl border border-[--color-border-subtle] bg-[--color-bg-secondary] lg:w-[60%]">
            <span className="text-sm text-[--color-text-tertiary]">
              {dict.screenshotPrefix} — {active.label}
            </span>
          </div>

          {/* Text content */}
          <div className="lg:w-[40%]">
            <h3 className="mb-3 text-xl font-semibold text-[--color-text-primary]">
              {active.title}
            </h3>
            <p className="mb-4 text-[--color-text-secondary] leading-relaxed">
              {active.description}
            </p>
            <ul className="space-y-2">
              {active.bullets.map((bullet) => (
                <li
                  key={bullet}
                  className="flex items-start gap-2 text-sm text-[--color-text-secondary]"
                >
                  <span className="mt-1 block h-1.5 w-1.5 shrink-0 rounded-full bg-[--color-accent]" />
                  {bullet}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
