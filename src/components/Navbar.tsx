import Image from "next/image";
import type { Dictionary, Locale } from "@/dictionaries";

interface NavbarProps {
  dict: Dictionary["nav"];
  locale: Locale;
  /** The page after the locale (e.g. "/updates"); empty on the home page. Elsewhere the section links lead home. */
  path?: string;
}

const LOCALE_LABELS: Record<Locale, string> = { en: "EN", ko: "한국어" };

export default function Navbar({ dict, locale, path = "" }: NavbarProps) {
  const otherLocale: Locale = locale === "en" ? "ko" : "en";
  const home = path ? `/${locale}` : "";
  const links = [
    { href: `${home}#how`, label: dict.how },
    { href: `${home}#privacy`, label: dict.privacy },
    { href: `${home}#requirements`, label: dict.requirements },
  ];

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-line-subtle/60 bg-bg/80 backdrop-blur-[12px]">
      <nav
        aria-label={dict.label}
        className="mx-auto flex h-14 max-w-content items-center justify-between gap-4 px-4 md:px-8"
      >
        <a href={`/${locale}`} className="flex min-h-11 items-center gap-2 rounded-md">
          <Image src="/nokka-mark.png" alt="" width={28} height={28} loading="eager" />
          <span className="text-lg font-semibold tracking-tight text-fg">Nokka</span>
        </a>

        <ul className="hidden items-center gap-7 md:flex">
          {links.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                className="inline-flex min-h-11 items-center text-sm text-fg-muted transition-colors duration-100 hover:text-fg"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-5">
          <div role="group" aria-label={dict.languageLabel} className="flex items-center text-sm">
            <span aria-current="true" className="font-medium text-fg">
              {LOCALE_LABELS[locale]}
            </span>
            <span aria-hidden="true" className="px-1.5 text-fg-subtle">
              |
            </span>
            <a
              href={`/${otherLocale}${path}`}
              lang={otherLocale}
              hrefLang={otherLocale}
              className="inline-flex min-h-11 items-center px-1 text-fg-subtle transition-colors duration-100 hover:text-fg"
            >
              {LOCALE_LABELS[otherLocale]}
            </a>
          </div>
          {/* Desktop only: on phones the hero button is the way in. */}
          <a
            href={`${home}#apply`}
            className="hidden h-11 items-center rounded-full bg-accent-strong px-4 text-sm font-medium text-white transition-colors duration-150 hover:bg-accent-stronger md:inline-flex"
          >
            {dict.apply}
          </a>
        </div>
      </nav>
    </header>
  );
}
