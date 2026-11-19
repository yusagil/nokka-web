import type { Metadata, Viewport } from "next";

// The admin pages live outside [locale], so they need their own <html>. Korean only, never indexed.
export const metadata: Metadata = {
  title: "Nokka 신청함",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0E0E10",
  colorScheme: "dark",
};

export default function AdminLayout({
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
