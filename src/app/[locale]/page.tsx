import { notFound } from "next/navigation";
import { getDictionary, hasLocale } from "@/dictionaries";
import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import Workflow from "@/components/Workflow";
import DataPaths from "@/components/DataPaths";
import FilesExport from "@/components/FilesExport";
import FeaturesGrid from "@/components/FeaturesGrid";
import Requirements from "@/components/Requirements";
import DownloadCTA from "@/components/DownloadCTA";
import Footer from "@/components/Footer";

export default async function Home({
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
      <Navbar dict={dict.nav} locale={locale} />
      <main id="main-content" className="flex-1">
        <Hero dict={dict.hero} />
        <Workflow dict={dict.how} />
        <DataPaths dict={dict.dataPaths} />
        <FilesExport dict={dict.files} />
        <FeaturesGrid dict={dict.features} />
        <Requirements dict={dict.requirements} />
        <DownloadCTA dict={dict.downloadCta} />
      </main>
      <Footer dict={dict.footer} />
    </>
  );
}
