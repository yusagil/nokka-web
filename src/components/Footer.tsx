import Image from "next/image";
import type { Dictionary } from "@/dictionaries";
import { ISSUES_URL, RELEASES_URL } from "@/lib/links";

interface FooterProps {
  dict: Dictionary["footer"];
}

export default function Footer({ dict }: FooterProps) {
  return (
    <footer className="border-t border-line-subtle">
      <div className="mx-auto flex max-w-content flex-col gap-4 px-4 py-8 text-sm sm:flex-row sm:items-center sm:justify-between md:px-8">
        <div className="flex items-center gap-2 text-fg-subtle">
          <Image src="/nokka-mark.png" alt="" width={20} height={20} />
          <span className="font-medium text-fg">Nokka</span>
          <span>{dict.copyright}</span>
        </div>
        <nav aria-label={dict.linksLabel}>
          <ul className="flex items-center gap-6">
            <li>
              <a
                href={RELEASES_URL}
                className="inline-flex min-h-11 items-center text-fg-muted underline-offset-4 hover:underline"
              >
                {dict.releaseNotes}
              </a>
            </li>
            <li>
              <a
                href={ISSUES_URL}
                className="inline-flex min-h-11 items-center text-fg-muted underline-offset-4 hover:underline"
              >
                {dict.contact}
              </a>
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  );
}
