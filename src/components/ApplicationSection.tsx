import type { Dictionary, Locale } from "@/dictionaries";
import ApplicationForm from "./ApplicationForm";

interface ApplicationSectionProps {
  dict: Dictionary["apply"];
  locale: Locale;
}

/** The steps stay above the form, so they are still there after the form turns into its confirmation. */
export default function ApplicationSection({ dict, locale }: ApplicationSectionProps) {
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

        <div className="mt-8 text-left">
          <h3 id="apply-steps-heading" className="text-base font-semibold text-fg">
            {dict.stepsHeading}
          </h3>
          <ol
            aria-labelledby="apply-steps-heading"
            className="mt-3 list-decimal space-y-2 pl-6 marker:font-semibold marker:text-accent-text"
          >
            {dict.steps.map((step) => (
              <li key={step} className="pl-1 text-pretty text-[15px] leading-relaxed text-fg-muted">
                {step}
              </li>
            ))}
          </ol>
        </div>

        <noscript>
          <p className="mt-6 rounded-[10px] border border-line bg-surface p-4 text-[15px] text-fg-muted">
            {dict.noscript}
          </p>
        </noscript>

        <ApplicationForm dict={dict.form} locale={locale} className="mt-8" />
      </div>
    </section>
  );
}
