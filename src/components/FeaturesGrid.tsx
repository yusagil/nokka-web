import type { ReactNode } from "react";
import type { Dictionary } from "@/dictionaries";
import SectionHeading from "./SectionHeading";

interface FeaturesGridProps {
  dict: Dictionary["features"];
}

type FeatureKey = keyof Dictionary["features"]["items"];

const icon = (children: ReactNode) => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

const ICONS: Record<FeatureKey, ReactNode> = {
  menubar: icon(
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 8h18M15 6h.01M18 6h.01" />
      <path d="M8 13h8M8 16h5" />
    </>,
  ),
  tracks: icon(
    <>
      <path d="M3 8h2l2-3 3 6 2-3h2l2-2 2 2h3" />
      <path d="M3 17h3l2-2 2 4 2-4 2 2h7" />
    </>,
  ),
  meetingEnd: icon(
    <>
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l2.5 2.5M10 2h4" />
    </>,
  ),
  calendar: icon(
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>,
  ),
  notice: icon(
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </>,
  ),
  playback: icon(
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 5 5" />
      <path d="m9 8 4 2.5L9 13z" />
    </>,
  ),
  screen: icon(
    <>
      <rect x="2" y="4" width="20" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
      <path d="M7 8h4M7 8v3M17 13h-4M17 13v-3" />
    </>,
  ),
  safety: icon(
    <>
      <path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6z" />
      <path d="m9 12 2 2 4-4" />
    </>,
  ),
};

const ORDER: FeatureKey[] = [
  "menubar",
  "tracks",
  "meetingEnd",
  "calendar",
  "notice",
  "playback",
  "screen",
  "safety",
];

export default function FeaturesGrid({ dict }: FeaturesGridProps) {
  return (
    <section
      id="features"
      aria-labelledby="features-heading"
      className="border-t border-line-subtle px-4 py-20 md:px-8 md:py-28"
    >
      <div className="mx-auto max-w-content">
        <SectionHeading id="features-heading" eyebrow={dict.eyebrow} heading={dict.heading} />
        <ul className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {ORDER.map((key) => {
            const feature = dict.items[key];
            return (
              <li
                key={key}
                className="reveal rounded-[14px] border border-line bg-surface p-6"
              >
                <div className="text-accent">{ICONS[key]}</div>
                <h3 className="mt-4 text-base font-semibold text-fg">{feature.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-fg-muted">
                  {feature.description}
                </p>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
