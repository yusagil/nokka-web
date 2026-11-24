import { Fragment, type ReactNode } from "react";
import type { Dictionary, Locale } from "@/dictionaries";

interface UpdateNoticeProps {
  dict: Dictionary["updates"];
  locale: Locale;
}

/**
 * The app's interface is Korean, so the English copy quotes its labels in Korean (‘코드 받기’). Each such quote is
 * marked lang="ko" so screen readers switch pronunciation (WCAG 3.1.2); the quote marks stay outside.
 */
function text(copy: string, locale: Locale): ReactNode {
  if (locale === "ko") return copy;
  return copy.split(/(‘[^’]*’)/).map((part, i) =>
    /^‘[^’]*\p{Script=Hangul}[^’]*’$/u.test(part) ? (
      <Fragment key={i}>
        ‘<span lang="ko">{part.slice(1, -1)}</span>’
      </Fragment>
    ) : (
      part
    )
  );
}

const sectionClass = "border-t border-line-subtle px-4 py-14 md:px-8 md:py-20";
const headingClass =
  "text-balance text-[24px] font-bold leading-[1.25] tracking-[-0.02em] text-fg md:text-[28px] md:leading-[1.2]";
const bodyClass = "text-pretty text-[15px] leading-relaxed text-fg-muted md:text-base";

/**
 * The page the old app's update window opens with '더 알아보기…' (the notice and the bridge both link here): how
 * updates now work and how to register a Mac. It names no installer, file or private channel, and works without
 * JavaScript.
 */
export default function UpdateNotice({ dict, locale }: UpdateNoticeProps) {
  return (
    <>
      <section
        aria-labelledby="updates-heading"
        className="relative overflow-hidden px-4 pb-14 pt-28 md:px-8 md:pb-20 md:pt-36"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-[480px]"
          style={{
            background:
              "radial-gradient(640px circle at 50% 0%, var(--color-accent-glow), transparent 70%)",
          }}
        />
        <div className="relative mx-auto max-w-[720px]">
          <p className="text-sm font-medium tracking-wide text-accent-text">{dict.eyebrow}</p>
          <h1
            id="updates-heading"
            className="mt-3 text-balance text-[32px] font-bold leading-[1.15] tracking-[-0.03em] text-fg md:text-[44px] md:leading-[1.1]"
          >
            {dict.heading}
          </h1>
          <p className="mt-5 text-pretty text-lg leading-relaxed text-fg-muted">{text(dict.intro, locale)}</p>
        </div>
      </section>

      <section aria-labelledby="updates-check-heading" className={sectionClass}>
        <div className="mx-auto max-w-[720px]">
          <h2 id="updates-check-heading" className={headingClass}>
            {dict.check.heading}
          </h2>
          <p className={`mt-4 ${bodyClass}`}>{text(dict.check.intro, locale)}</p>
          <dl className="mt-6 divide-y divide-line-subtle border-y border-line-subtle">
            {dict.check.cases.map((item) => (
              <div key={item.term} className="grid gap-1 py-4 sm:grid-cols-[180px_1fr] sm:gap-4">
                <dt className="text-sm font-medium text-fg">{item.term}</dt>
                <dd className={bodyClass}>{text(item.detail, locale)}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section id="register" aria-labelledby="updates-register-heading" className={sectionClass}>
        <div className="mx-auto max-w-[720px]">
          <h2 id="updates-register-heading" className={headingClass}>
            {dict.register.heading}
          </h2>
          <ol className="mt-6 list-decimal space-y-4 pl-6 marker:font-semibold marker:text-accent-text">
            {dict.register.steps.map((step) => (
              <li key={step} className={`pl-2 ${bodyClass}`}>
                {text(step, locale)}
              </li>
            ))}
          </ol>

          <div className="mt-8 rounded-[10px] border border-line bg-surface p-5">
            <h3 className="text-base font-semibold text-fg">{dict.register.notesHeading}</h3>
            <ul className="mt-3 list-disc space-y-2 pl-5 marker:text-fg-subtle">
              {dict.register.notes.map((note) => (
                <li key={note} className={bodyClass}>
                  {text(note, locale)}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section id="change" aria-labelledby="updates-change-heading" className={sectionClass}>
        <div className="mx-auto max-w-[720px]">
          <h2 id="updates-change-heading" className={headingClass}>
            {dict.change.heading}
          </h2>
          <ul className="mt-6 list-disc space-y-3 pl-5 marker:text-fg-subtle">
            {dict.change.items.map((item) => (
              <li key={item} className={bodyClass}>
                {text(item, locale)}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="installer" aria-labelledby="updates-installer-heading" className={sectionClass}>
        <div className="mx-auto max-w-[720px]">
          <h2 id="updates-installer-heading" className={headingClass}>
            {dict.installer.heading}
          </h2>
          {dict.installer.body.map((paragraph) => (
            <p key={paragraph} className={`mt-4 ${bodyClass}`}>
              {text(paragraph, locale)}
            </p>
          ))}
        </div>
      </section>

      <section aria-labelledby="updates-apply-heading" className={sectionClass}>
        <div className="mx-auto max-w-[720px]">
          <h2 id="updates-apply-heading" className={headingClass}>
            {dict.apply.heading}
          </h2>
          <p className={`mt-4 ${bodyClass}`}>{text(dict.apply.body, locale)}</p>
          <a
            href={`/${locale}#apply`}
            className="mt-6 inline-flex h-11 items-center rounded-full bg-accent-strong px-5 text-sm font-medium text-white transition-colors duration-150 hover:bg-accent-stronger"
          >
            {dict.apply.link}
          </a>
        </div>
      </section>
    </>
  );
}
