import type { Dictionary } from "@/dictionaries";
import SectionHeading from "./SectionHeading";

interface DataPathsProps {
  dict: Dictionary["dataPaths"];
}

type Row = Dictionary["dataPaths"]["table"]["rows"][number];

function CloudIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0">
      <path
        d="M7 18h10.5a4 4 0 0 0 .6-7.96A6 6 0 0 0 6.4 9.1 4.5 4.5 0 0 0 7 18z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MacIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0">
      <rect x="3" y="4" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M9 20h6M12 16v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="mt-[3px] shrink-0 text-ok">
      <path d="m5 12.5 4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Local({ row }: { row: Row }) {
  return (
    <span className="inline-flex items-start gap-2">
      <span className="mt-[3px] text-ok">
        <MacIcon />
      </span>
      {row.local}
    </span>
  );
}

function Connected({ row, table }: { row: Row; table: Dictionary["dataPaths"]["table"] }) {
  if (row.connected === table.notApplicable) {
    return <span className="text-fg-subtle">{row.connected}</span>;
  }
  return (
    <span className="inline-flex items-start gap-2">
      <span className="mt-[3px] text-cloud">
        <CloudIcon />
      </span>
      <span>
        {row.connected}
        <span className="sr-only"> ({table.leavesMac})</span>
      </span>
    </span>
  );
}

export default function DataPaths({ dict }: DataPathsProps) {
  const { table } = dict;
  const [stageLabel, localLabel, connectedLabel] = table.columns;

  return (
    <section
      id="privacy"
      aria-labelledby="privacy-heading"
      className="border-y border-line-subtle bg-surface/50 px-4 py-20 md:px-8 md:py-28"
    >
      <div className="mx-auto max-w-content">
        <SectionHeading
          id="privacy-heading"
          eyebrow={dict.eyebrow}
          heading={dict.heading}
          intro={dict.intro}
        />

        {/* Wide screens: a table. Narrow screens: one card per step (only one is rendered visibly). */}
        <div className="reveal mt-12 hidden overflow-hidden rounded-[14px] border border-line bg-bg md:block">
          <table className="w-full border-collapse text-left text-[15px]">
            <caption className="sr-only">{table.caption}</caption>
            <thead>
              <tr className="border-b border-line text-sm text-fg-subtle">
                {table.columns.map((column) => (
                  <th key={column} scope="col" className="px-5 py-3 font-medium">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row) => (
                <tr key={row.stage} className="border-b border-line-subtle last:border-b-0">
                  <th scope="row" className="w-[30%] px-5 py-4 align-top font-medium text-fg">
                    {row.stage}
                  </th>
                  <td className="px-5 py-4 align-top text-fg-muted">
                    <Local row={row} />
                  </td>
                  <td className="px-5 py-4 align-top text-fg-muted">
                    <Connected row={row} table={table} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <ul aria-label={table.caption} className="mt-10 space-y-3 md:hidden">
          {table.rows.map((row) => (
            <li key={row.stage} className="rounded-[14px] border border-line bg-bg p-4">
              <p className="font-medium text-fg">
                <span className="sr-only">{stageLabel}: </span>
                {row.stage}
              </p>
              <dl className="mt-3 space-y-2 text-[15px] text-fg-muted">
                <div>
                  <dt className="text-xs text-fg-subtle">{localLabel}</dt>
                  <dd className="mt-0.5">
                    <Local row={row} />
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-fg-subtle">{connectedLabel}</dt>
                  <dd className="mt-0.5">
                    <Connected row={row} table={table} />
                  </dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_1.2fr]">
          <div className="reveal rounded-[14px] border border-accent/40 bg-accent-soft p-6">
            <h3 className="text-lg font-semibold text-fg">{dict.localOnly.title}</h3>
            <p className="mt-2 leading-relaxed text-fg-muted">{dict.localOnly.description}</p>
          </div>
          <ul className="reveal grid gap-3 sm:grid-cols-2">
            {dict.facts.map((fact) => (
              <li
                key={fact}
                className="flex gap-3 rounded-[10px] border border-line bg-bg p-4 text-[15px] leading-relaxed text-fg-muted"
              >
                <CheckIcon />
                {fact}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
