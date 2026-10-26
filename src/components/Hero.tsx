import type { Dictionary } from "@/dictionaries";
import DownloadButton from "./DownloadButton";
import Screenshot from "./Screenshot";

interface HeroProps {
  dict: Dictionary["hero"];
}

// Load sequence (DESIGN_REQUIREMENTS §4): CSS only, so the hero is visible without JavaScript.
const rise = (delay: number) => ({ animationDelay: `${delay}ms` });

export default function Hero({ dict }: HeroProps) {
  return (
    <section
      aria-labelledby="hero-heading"
      className="relative overflow-hidden px-4 pb-16 pt-28 md:px-8 md:pb-24 md:pt-36"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[640px]"
        style={{
          background:
            "radial-gradient(720px circle at 50% 0%, var(--color-accent-glow), transparent 70%)",
        }}
      />

      <div className="relative mx-auto flex max-w-content flex-col items-center text-center">
        <p
          className="motion-safe:animate-rise inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-sm text-fg-muted"
          style={rise(0)}
        >
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-accent" />
          {dict.eyebrow}
        </p>
        <h1
          id="hero-heading"
          className="motion-safe:animate-rise mt-6 max-w-[760px] whitespace-pre-line text-balance text-[36px] font-bold leading-[1.15] tracking-[-0.03em] text-fg md:text-[44px] lg:text-[56px] lg:leading-[1.1]"
          style={rise(100)}
        >
          {dict.headline}
        </h1>
        <p
          className="motion-safe:animate-rise mt-5 max-w-[600px] text-pretty text-lg leading-relaxed text-fg-muted"
          style={rise(200)}
        >
          {dict.subheadline}
        </p>

        <div
          className="motion-safe:animate-rise mt-8 flex flex-col items-center gap-4 sm:flex-row"
          style={rise(300)}
        >
          <DownloadButton label={dict.cta} hint={dict.ctaHint} />
          <a
            href="#how"
            className="inline-flex h-12 items-center rounded-full px-5 text-base font-medium text-fg-muted transition-colors duration-100 hover:text-fg"
          >
            {dict.secondary}
            <span aria-hidden="true" className="ml-1.5">
              ↓
            </span>
          </a>
        </div>

        <ul
          className="motion-safe:animate-rise mt-4 flex flex-wrap justify-center gap-x-2 text-sm text-fg-subtle"
          style={rise(300)}
        >
          {dict.meta.map((item, i) => (
            <li key={item} className="flex items-center gap-2">
              {i > 0 && <span aria-hidden="true">·</span>}
              {item}
            </li>
          ))}
        </ul>

        <Screenshot
          src="/screens/live-window.png"
          alt={dict.screenshotAlt}
          width={1520}
          height={720}
          caption={dict.caption}
          preload
          sizes="(min-width: 1024px) 960px, 100vw"
          className="mt-14 w-full max-w-[960px] md:mt-16"
        />
      </div>
    </section>
  );
}
