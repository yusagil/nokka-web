import type { Metadata, Viewport } from "next";

// The private install link page lives outside [locale], so it needs its own <html>. Never indexed and
// never a referrer: the page's address carries the link's secret in its fragment until the page reads it.
export const metadata: Metadata = {
  title: "Nokka 설치 파일 (Installer)",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0E0E10",
  colorScheme: "dark",
};

export default function InstallLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
