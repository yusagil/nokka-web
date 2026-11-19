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

  // The private admin pages are Korean-only and not localized. Access is checked on the server
  // (layout and API), not here; this only keeps search terms and URLs out of referrers and indexes.
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    const response = NextResponse.next();
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
    return response;
  }

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
    // Skip internal paths (_next, api) and anything that looks like a file (images, icons, robots.txt)
    "/((?!_next|api|.*\\..*).*)",
  ],
};
