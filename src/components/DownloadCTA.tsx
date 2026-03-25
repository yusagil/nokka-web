interface DownloadCTAProps {
  dict: {
    heading: string;
    subheading: string;
    cta: string;
    requirements: string;
  };
}

export default function DownloadCTA({ dict }: DownloadCTAProps) {
  return (
    <section
      id="download"
      className="relative py-24 px-4 text-center"
    >
      {/* Subtle radial glow */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(600px circle at 50% 50%, var(--color-accent-glow), transparent 70%)",
        }}
        aria-hidden="true"
      />

      <div className="relative mx-auto max-w-[1120px]">
        <h2 className="mb-4 text-[40px] font-bold leading-tight text-[--color-text-primary]">
          {dict.heading}
        </h2>
        <p className="mb-8 text-lg text-[--color-text-secondary]">
          {dict.subheading}
        </p>

        <a
          href="#"
          className="mx-auto inline-flex h-14 items-center gap-2 rounded-full bg-[--color-accent] px-8 text-lg font-medium text-white transition-colors duration-150 hover:bg-[--color-accent-hover]"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 18 18"
            fill="none"
            aria-hidden="true"
            className="shrink-0"
          >
            <path
              d="M9 2.25v9.75m0 0L5.25 8.25M9 12l3.75-3.75M3 14.25h12"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {dict.cta}
        </a>

        <p
          className="mt-6 text-sm text-[--color-text-tertiary]"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {dict.requirements}
        </p>
      </div>
    </section>
  );
}
