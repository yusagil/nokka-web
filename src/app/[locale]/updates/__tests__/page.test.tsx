import { render, screen, within } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import ko from "@/dictionaries/ko.json";
import Updates, { generateMetadata } from "../page";

const params = (locale: string) => ({ params: Promise.resolve({ locale }) });

describe("/[locale]/updates", () => {
  it("is its own canonical page in both languages", async () => {
    const metadata = await generateMetadata(params("ko"));
    expect(metadata.title).toBe(ko.updates.meta.title);
    expect(metadata.description).toBe(ko.updates.meta.description);
    expect(metadata.alternates).toEqual({
      canonical: "/ko/updates",
      languages: { en: "/en/updates", ko: "/ko/updates" },
    });
    expect(metadata.openGraph).toMatchObject({
      title: ko.updates.meta.title,
      url: "/ko/updates",
      locale: "ko_KR",
      siteName: "Nokka",
      images: [expect.objectContaining({ url: "/og-ko.png", width: 1200, height: 630 })],
    });
    expect(metadata.twitter).toMatchObject({ card: "summary_large_image", title: ko.updates.meta.title });
  });

  it("puts the notice in the main landmark, between the menu and the footer", async () => {
    render(await Updates(params("en")));
    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("id", "main-content");
    expect(within(main).getByRole("heading", { level: 1, name: "Nokka updates are changing" })).toBeInTheDocument();
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "한국어" })).toHaveAttribute("href", "/ko/updates");
  });

  it("has no metadata and no page for another locale", async () => {
    expect(await generateMetadata(params("fr"))).toEqual({});
    await expect(Updates(params("fr"))).rejects.toThrow();
  });
});
