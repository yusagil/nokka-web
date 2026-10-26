import type { Dictionary } from "@/dictionaries";

interface MinutesExampleProps {
  dict: Dictionary["how"]["steps"]["minutes"]["example"];
}

/** The shape of a summary.md the app writes, with citation chips as the library shows them. */
export default function MinutesExample({ dict }: MinutesExampleProps) {
  // The minutes text is Korean on every locale; its labels follow the page language.
  const lang = dict.lang;

  return (
    <figure className="w-full max-w-[520px]">
      <div className="overflow-hidden rounded-[14px] border border-line bg-surface shadow-[0_4px_12px_rgba(0,0,0,0.4)]">
        <div className="flex items-center justify-between gap-4 border-b border-line-subtle bg-surface-2 px-5 py-3">
          <span className="text-sm text-fg-muted">{dict.label}</span>
          <span className="font-mono text-xs text-fg-subtle">{dict.file}</span>
        </div>
        <div className="space-y-5 px-5 py-6">
          <p lang={lang} className="text-xl font-semibold text-fg">
            {dict.title}
          </p>
          {dict.sections.map((section) => (
            <div key={section.heading}>
              <p lang={lang} className="text-sm font-semibold text-fg-muted">
                {section.heading}
              </p>
              <ul className="mt-2 space-y-2">
                {section.items.map((item) => (
                  <li key={item.text} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-fg">
                    <span aria-hidden="true" className="text-fg-subtle">
                      –
                    </span>
                    <span lang={lang}>{item.text}</span>
                    {item.cite && (
                      <span className="rounded-md bg-accent-soft px-1.5 py-0.5 font-mono text-xs text-accent-text">
                        <span className="sr-only">{dict.citeLabel} </span>
                        {item.cite}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
      <figcaption className="mt-3 text-sm leading-relaxed text-fg-subtle">{dict.note}</figcaption>
    </figure>
  );
}
