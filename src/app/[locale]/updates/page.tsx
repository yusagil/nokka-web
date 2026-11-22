import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDictionary, hasLocale } from "@/dictionaries";
import Navbar from "@/components/Navbar";
import UpdateNotice from "@/components/UpdateNotice";
import Footer from "@/components/Footer";

const PATH = "/updates";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(locale)) return {};

  const dict = await getDictionary(locale);
  const { title, description } = dict.updates.meta;
  const ogImage = {
    url: `/og-${locale}.png`,
    width: 1200,
    height: 630,
    alt: dict.meta.ogAlt,
  };

  // Metadata merges shallowly: openGraph, twitter and alternates replace the layout's, so they are given in full.
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      url: `/${locale}${PATH}`,
      locale: locale === "ko" ? "ko_KR" : "en_US",
      siteName: "Nokka",
      images: [ogImage],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage],
    },
    alternates: {
      canonical: `/${locale}${PATH}`,
      languages: {
        en: `/en${PATH}`,
        ko: `/ko${PATH}`,
      },
    },
  };
}

export default async function Updates({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!hasLocale(locale)) {
    notFound();
  }

  const dict = await getDictionary(locale);

  return (
    <>
      <Navbar dict={dict.nav} locale={locale} path={PATH} />
      <main id="main-content" className="flex-1">
        <UpdateNotice dict={dict.updates} locale={locale} />
      </main>
      <Footer dict={dict.footer} />
    </>
  );
}
