import type { Dictionary } from "@/dictionaries";
import SectionHeading from "./SectionHeading";

interface FilesExportProps {
  dict: Dictionary["files"];
}

const FOLDER = "Nokka_2026-10-26_10-30-00/";

export default function FilesExport({ dict }: FilesExportProps) {
  return (
    <section id="files" aria-labelledby="files-heading" className="px-4 py-20 md:px-8 md:py-28">
      <div className="mx-auto grid max-w-content items-start gap-12 lg:grid-cols-2 lg:gap-16">
        <div>
          <SectionHeading
            id="files-heading"
            eyebrow={dict.eyebrow}
            heading={dict.heading}
            intro={dict.intro}
          />
          <h3 className="mt-10 text-sm font-semibold text-fg">{dict.formatsHeading}</h3>
          <ul className="mt-3 flex flex-wrap gap-2">
            {dict.formats.map((format) => (
              <li
                key={format}
                className="rounded-full border border-line bg-surface px-3.5 py-1.5 text-sm text-fg-muted"
              >
                {format}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-[15px] leading-relaxed text-fg-muted">{dict.formatsNote}</p>
        </div>

        <figure className="reveal overflow-hidden rounded-[14px] border border-line bg-surface lg:mt-10">
          <figcaption className="border-b border-line-subtle bg-surface-2 px-5 py-3 text-sm text-fg-muted">
            {dict.treeLabel}
          </figcaption>
          <div className="overflow-x-auto px-5 py-5">
            <p className="font-mono text-sm text-fg">{FOLDER}</p>
            <ul className="mt-2 space-y-3">
              {dict.tree.map((entry, i) => (
                <li key={entry.name} className="flex gap-3 font-mono text-sm">
                  <span aria-hidden="true" className="shrink-0 whitespace-pre text-fg-subtle">
                    {i === dict.tree.length - 1 ? "└──" : "├──"}
                  </span>
                  <span className="min-w-0">
                    <span className="block break-all text-fg">{entry.name}</span>
                    <span className="block font-sans text-[13px] text-fg-subtle">{entry.note}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </figure>
      </div>
    </section>
  );
}
