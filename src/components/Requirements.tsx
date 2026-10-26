import type { Dictionary } from "@/dictionaries";
import SectionHeading from "./SectionHeading";

interface RequirementsProps {
  dict: Dictionary["requirements"];
}

export default function Requirements({ dict }: RequirementsProps) {
  return (
    <section
      id="requirements"
      aria-labelledby="requirements-heading"
      className="border-t border-line-subtle px-4 py-20 md:px-8 md:py-28"
    >
      <div className="mx-auto max-w-content">
        <SectionHeading id="requirements-heading" eyebrow={dict.eyebrow} heading={dict.heading} />

        <div className="mt-12 grid gap-10 lg:grid-cols-2 lg:gap-16">
          <div className="reveal">
            <h3 className="text-lg font-semibold text-fg">{dict.requirementsHeading}</h3>
            <dl className="mt-4 divide-y divide-line-subtle border-y border-line-subtle">
              {dict.items.map((item) => (
                <div key={item.term} className="grid gap-1 py-4 sm:grid-cols-[120px_1fr] sm:gap-4">
                  <dt className="text-sm font-medium text-fg">{item.term}</dt>
                  <dd className="text-[15px] leading-relaxed text-fg-muted">{item.detail}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="reveal">
            <h3 className="text-lg font-semibold text-fg">{dict.limitsHeading}</h3>
            <ul className="mt-4 space-y-3">
              {dict.limits.map((limit) => (
                <li
                  key={limit}
                  className="flex gap-3 rounded-[10px] border border-line bg-surface p-4 text-[15px] leading-relaxed text-fg-muted"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden="true"
                    className="mt-[3px] shrink-0 text-[#ff9f0a]"
                  >
                    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
                    <path d="M12 7.5v5.5M12 16.5h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                  {limit}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
