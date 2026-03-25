import Image from "next/image";
import type { Locale } from "@/dictionaries";

interface FooterProps {
  dict: {
    copyright: string;
    releaseNotes: string;
    contact: string;
  };
  locale: Locale;
}

export default function Footer({ dict, locale }: FooterProps) {
  return (
    <footer className="border-t border-[--color-border-subtle]">
      <div className="max-w-[1120px] mx-auto px-4 md:px-8 py-8 flex items-center justify-between text-sm">
        <div className="flex items-center gap-2 text-[--color-text-tertiary]">
          <Image
            src="/logo.png"
            alt="Nokka"
            width={20}
            height={20}
            className="rounded-sm"
          />
          <span className="text-[--color-text-primary] font-medium">Nokka</span>
          <span>{dict.copyright}</span>
        </div>
        <div className="flex items-center gap-6">
          <a
            href={`/${locale}/release-notes`}
            className="text-[--color-text-secondary] hover:underline transition-colors duration-[--duration-normal]"
          >
            {dict.releaseNotes}
          </a>
          <a
            href="mailto:contact@nokka.app"
            className="text-[--color-text-secondary] hover:underline transition-colors duration-[--duration-normal]"
          >
            {dict.contact}
          </a>
        </div>
      </div>
    </footer>
  );
}
