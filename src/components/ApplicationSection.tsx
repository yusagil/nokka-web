import type { Dictionary } from "@/dictionaries";
import ApplicationForm from "./ApplicationForm";

interface ApplicationSectionProps {
  dict: Dictionary["apply"];
}

export default function ApplicationSection({ dict }: ApplicationSectionProps) {
  return (
    <section
      id="apply"
      aria-labelledby="apply-heading"
      className="relative overflow-hidden border-t border-line-subtle px-4 py-20 md:px-8 md:py-28"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(640px circle at 50% 50%, var(--color-accent-glow), transparent 70%)",
        }}
      />

      <div className="relative mx-auto max-w-[480px] text-center">
        <h2
          id="apply-heading"
          className="text-balance text-[28px] font-bold leading-[1.2] tracking-[-0.02em] text-fg md:text-[40px] md:leading-[1.15]"
        >
          {dict.heading}
        </h2>
        <p className="mt-4 text-pretty text-lg leading-relaxed text-fg-muted">{dict.intro}</p>

        <noscript>
          <p className="mt-6 rounded-[10px] border border-line bg-surface p-4 text-[15px] text-fg-muted">
            {dict.noscript}
          </p>
        </noscript>

        <ApplicationForm dict={dict.form} className="mt-10" />
      </div>
    </section>
  );
}
