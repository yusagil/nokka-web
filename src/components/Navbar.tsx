import Image from "next/image";
import type { Locale } from "@/dictionaries";

interface NavbarProps {
  dict: {
    features: string;
    download: string;
  };
  locale: Locale;
}

export default function Navbar({ dict, locale }: NavbarProps) {
  const otherLocale = locale === "en" ? "ko" : "en";
  const otherLocaleLabel = locale === "en" ? "한국어" : "EN";
  const currentLocaleLabel = locale === "en" ? "EN" : "한국어";

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 backdrop-blur-[12px] bg-[--color-bg-primary]/80">
      <div className="max-w-[1120px] mx-auto px-4 md:px-8 flex items-center justify-between h-14">
        <a href={`/${locale}`} className="flex items-center gap-2">
          <Image
            src="/logo.png"
            alt="Nokka"
            width={28}
            height={28}
            className="rounded-md"
          />
          <span className="font-semibold text-lg text-[--color-text-primary]">
            Nokka
          </span>
        </a>
        <div className="flex items-center gap-8">
          <a
            href="#features"
            className="hidden md:inline text-sm text-[--color-text-secondary] hover:text-[--color-text-primary] transition-colors duration-[--duration-normal]"
          >
            {dict.features}
          </a>
          <span className="text-sm text-[--color-text-tertiary]">
            <span className="text-[--color-text-primary] font-medium">
              {currentLocaleLabel}
            </span>
            {" | "}
            <a
              href={`/${otherLocale}`}
              className="hover:text-[--color-text-primary] transition-colors duration-[--duration-normal]"
            >
              {otherLocaleLabel}
            </a>
          </span>
          <a
            href="#download"
            className="text-sm text-[--color-text-secondary] hover:text-[--color-text-primary] transition-colors duration-[--duration-normal]"
          >
            {dict.download}
          </a>
        </div>
      </div>
    </nav>
  );
}
