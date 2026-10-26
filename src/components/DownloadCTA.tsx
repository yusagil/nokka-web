import type { Dictionary } from "@/dictionaries";
import { LATEST_RELEASE_URL } from "@/lib/links";
import DownloadButton from "./DownloadButton";

interface DownloadCTAProps {
  dict: Dictionary["downloadCta"];
}

export default function DownloadCTA({ dict }: DownloadCTAProps) {
  return (
    <section
      id="download"
      aria-labelledby="download-heading"
      className="relative overflow-hidden border-t border-line-subtle px-4 py-24 text-center md:px-8 md:py-32"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(640px circle at 50% 50%, var(--color-accent-glow), transparent 70%)",
        }}
      />

      <div className="relative mx-auto max-w-[640px]">
        <h2
          id="download-heading"
          className="text-[32px] font-bold leading-[1.15] tracking-[-0.025em] text-fg md:text-[40px]"
        >
          {dict.heading}
        </h2>
        <p className="mt-4 text-lg leading-relaxed text-fg-muted">{dict.subheading}</p>

        <div className="mt-10">
          <DownloadButton label={dict.cta} hint={dict.ctaHint} size="lg" />
        </div>

        <ul className="mt-6 flex flex-wrap justify-center gap-x-2 font-mono text-sm text-fg-subtle">
          {dict.meta.map((item, i) => (
            <li key={item} className="flex items-center gap-2">
              {i > 0 && <span aria-hidden="true">/</span>}
              {item}
            </li>
          ))}
        </ul>

        <a
          href={LATEST_RELEASE_URL}
          className="mt-4 inline-flex min-h-11 items-center text-sm text-accent-text underline-offset-4 hover:underline"
        >
          {dict.releaseLink}
          <span aria-hidden="true" className="ml-1">
            →
          </span>
        </a>
      </div>
    </section>
  );
}
