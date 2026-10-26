import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { hasLocale, getDictionary, locales } from "@/dictionaries";
import { DOWNLOAD_URL, SITE_URL } from "@/lib/links";

export async function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(locale)) return {};

  const dict = await getDictionary(locale);
  const ogImage = {
    url: `/og-${locale}.png`,
    width: 1200,
    height: 630,
    alt: dict.meta.ogAlt,
  };

  return {
    metadataBase: new URL(SITE_URL),
    title: dict.meta.title,
    description: dict.meta.description,
    robots: "index, follow",
    openGraph: {
      title: dict.meta.title,
      description: dict.meta.description,
      type: "website",
      url: `/${locale}`,
      locale: locale === "ko" ? "ko_KR" : "en_US",
      siteName: "Nokka",
      images: [ogImage],
    },
    twitter: {
      card: "summary_large_image",
      title: dict.meta.title,
      description: dict.meta.description,
      images: [ogImage],
    },
    alternates: {
      canonical: `/${locale}`,
      languages: {
        en: "/en",
        ko: "/ko",
      },
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0E0E10",
  colorScheme: "dark",
};

export default async function LocaleLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}>) {
  const { locale } = await params;

  if (!hasLocale(locale)) {
    notFound();
  }

  const dict = await getDictionary(locale);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Nokka",
    operatingSystem: "macOS 14 or later",
    softwareRequirements: "Apple silicon Mac, macOS 14 Sonoma or later",
    applicationCategory: "BusinessApplication",
    downloadUrl: DOWNLOAD_URL,
    url: `${SITE_URL}/${locale}`,
    inLanguage: locale,
    description: dict.meta.description,
  };

  return (
    <html lang={locale} className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-[10px] focus:bg-accent-strong focus:px-4 focus:py-2 focus:text-white"
        >
          {dict.skipToContent}
        </a>
        {children}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </body>
    </html>
  );
}
