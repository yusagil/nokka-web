import type { FeedItem } from "./store";

export const SPARKLE_NAMESPACE = "http://www.andymatuschak.org/xml-namespaces/sparkle";
export const NOKKA_NAMESPACE = "https://nokka-web.vercel.app/ns/updates/v1";
export const PACKAGES_PATH = "/api/updates/v1/packages";
export const PACKAGE_FILE_NAME = "Nokka.dmg";

/** The download address of `build` on `origin` (the same origin the feed was read from). */
export function packageUrl(origin: string, build: number): string {
  return `${origin}${PACKAGES_PATH}/${build}/${PACKAGE_FILE_NAME}`;
}

/**
 * The protected Sparkle feed: one item for the current build, or an empty channel. Release notes are
 * inline plain text; nothing points to another origin, so the app's bearer token never leaves it.
 */
export function renderAppcast(item: FeedItem | null, origin: string): string {
  const lines = [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<rss version="2.0" xmlns:sparkle="${SPARKLE_NAMESPACE}" xmlns:nokka="${NOKKA_NAMESPACE}">`,
    `  <channel>`,
    `    <title>Nokka</title>`,
  ];
  if (item) {
    const notes = item.releaseNotes.trim() || `Nokka ${item.shortVersion} (${item.build})`;
    lines.push(
      `    <item>`,
      `      <title>${escapeXml(`Nokka ${item.shortVersion}`)}</title>`,
      `      <pubDate>${item.publishedAt.toUTCString().replace("GMT", "+0000")}</pubDate>`,
      `      <sparkle:version>${item.build}</sparkle:version>`,
      `      <sparkle:shortVersionString>${escapeXml(item.shortVersion)}</sparkle:shortVersionString>`,
      `      <sparkle:minimumSystemVersion>${escapeXml(item.minimumSystemVersion)}</sparkle:minimumSystemVersion>`,
      `      <description sparkle:format="plain-text">${escapeXml(notes)}</description>`,
      `      <nokka:targetCDHash>${escapeXml(item.targetCDHash)}</nokka:targetCDHash>`,
      `      <enclosure url="${escapeXml(packageUrl(origin, item.build))}" length="${item.byteLength}"` +
        ` type="application/octet-stream" sparkle:edSignature="${escapeXml(item.edSignature)}"/>`,
      `    </item>`,
    );
  }
  lines.push(`  </channel>`, `</rss>`, ``);
  return lines.join("\n");
}

/** Text and attribute values; also drops characters XML 1.0 can not carry. */
function escapeXml(value: string): string {
  return value
    .replace(/[^\u0009\u000a\u000d -퟿-�\u{10000}-\u{10ffff}]/gu, "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
