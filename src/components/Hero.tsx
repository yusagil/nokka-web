"use client";
import Image from "next/image";
import { useSyncExternalStore } from "react";

// Always returns true on client (after hydration), false on server
const emptySubscribe = () => () => {};
function useHydrated() {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
}

interface HeroProps {
  dict: {
    headline: string;
    subheadline: string;
    cta: string;
    requirements: string;
    screenshotAlt: string;
  };
}

export default function Hero({ dict }: HeroProps) {
  const hydrated = useHydrated();

  const fadeStyle = (delay: number) => ({
    opacity: hydrated ? 1 : 0,
    transform: hydrated ? "translateY(0)" : "translateY(16px)",
    transition: `opacity 400ms ease-out ${delay}ms, transform 400ms ease-out ${delay}ms`,
  });

  return (
    <section className="flex flex-col items-center text-center pt-32 pb-20 px-4 md:px-8">
      <h1
        className="text-4xl md:text-[56px] md:leading-[1.1] font-bold text-[--color-text-primary] max-w-[680px] tracking-tight"
        style={fadeStyle(100)}
      >
        {dict.headline}
      </h1>
      <p
        className="mt-6 text-lg text-[--color-text-secondary] max-w-[520px] leading-relaxed"
        style={fadeStyle(200)}
      >
        {dict.subheadline}
      </p>
      <a
        href="#download"
        className="mt-10 inline-flex items-center justify-center gap-2 h-12 px-8 text-base font-medium text-white bg-[--color-accent] hover:bg-[--color-accent-hover] rounded-full transition-colors duration-[--duration-normal] focus-visible:outline-2 focus-visible:outline-[--color-accent] focus-visible:outline-offset-2"
        style={fadeStyle(300)}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 20 20"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <path
            d="M10 3v10m0 0l-3.5-3.5M10 13l3.5-3.5M4 17h12"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {dict.cta}
      </a>
      <p
        className="mt-4 text-sm text-[--color-text-tertiary]"
        style={fadeStyle(300)}
      >
        {dict.requirements}
      </p>
      <div className="mt-16 w-full max-w-[1120px]" style={fadeStyle(400)}>
        <Image
          src="/hero-screenshot.svg"
          alt={dict.screenshotAlt}
          width={1120}
          height={700}
          className="w-full rounded-[20px] shadow-lg"
          priority
        />
      </div>
    </section>
  );
}
