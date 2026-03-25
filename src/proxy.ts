import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const locales = ["en", "ko"];
const defaultLocale = "en";

function getLocale(request: NextRequest): string {
  const acceptLanguage = request.headers.get("accept-language") || "";
  const preferred = acceptLanguage
    .split(",")
    .map((lang) => lang.split(";")[0].trim().toLowerCase());

  for (const lang of preferred) {
    // Check exact match first (e.g., "ko", "en")
    if (locales.includes(lang)) return lang;
    // Check language prefix (e.g., "ko-KR" -> "ko", "en-US" -> "en")
    const prefix = lang.split("-")[0];
    if (locales.includes(prefix)) return prefix;
  }

  return defaultLocale;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Check if the pathname already has a locale prefix
  const pathnameHasLocale = locales.some(
    (locale) => pathname.startsWith(`/${locale}/`) || pathname === `/${locale}`
  );

  if (pathnameHasLocale) return;

  // Redirect to the locale-prefixed path
  const locale = getLocale(request);
  request.nextUrl.pathname = `/${locale}${pathname}`;
  return NextResponse.redirect(request.nextUrl);
}

export const config = {
  matcher: [
    // Skip internal paths (_next), static files, and metadata files
    "/((?!_next|api|favicon.ico|icon.svg|og-image.png|logo.png|hero-screenshot.svg|sitemap.xml|robots.txt).*)",
  ],
};
