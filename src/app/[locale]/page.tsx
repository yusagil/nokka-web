import { notFound } from "next/navigation";
import { getDictionary, hasLocale } from "@/dictionaries";
import type { Locale } from "@/dictionaries";
import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import ValueProps from "@/components/ValueProps";
import FeatureShowcase from "@/components/FeatureShowcase";
import FeaturesGrid from "@/components/FeaturesGrid";
import Comparison from "@/components/Comparison";
import TrustBadges from "@/components/TrustBadges";
import DownloadCTA from "@/components/DownloadCTA";
import Footer from "@/components/Footer";
import AnimateIn from "@/components/AnimateIn";

export default async function Home({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!hasLocale(locale)) {
    notFound();
  }

  const dict = await getDictionary(locale as Locale);

  return (
    <>
      <Navbar dict={dict.nav} locale={locale as Locale} />
      <main id="main-content" className="flex-1">
        <Hero dict={dict.hero} />
        <AnimateIn>
          <ValueProps dict={dict.valueProps} />
        </AnimateIn>
        <AnimateIn delay={100}>
          <FeatureShowcase dict={dict.featureShowcase} />
        </AnimateIn>
        <AnimateIn>
          <FeaturesGrid dict={dict.featuresGrid} />
        </AnimateIn>
        <AnimateIn>
          <Comparison dict={dict.comparison} />
        </AnimateIn>
        <AnimateIn>
          <TrustBadges dict={dict.trustBadges} />
        </AnimateIn>
        <AnimateIn>
          <DownloadCTA dict={dict.downloadCta} />
        </AnimateIn>
      </main>
      <Footer dict={dict.footer} locale={locale as Locale} />
    </>
  );
}
