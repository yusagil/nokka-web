// @vitest-environment node
import { describe, expect, it } from "vitest";
import { renderAppcast } from "../appcast";
import type { FeedItem } from "../store";

const ORIGIN = "https://nokka-web.vercel.app";
const item: FeedItem = {
  build: 24,
  shortVersion: "2.7.0",
  minimumSystemVersion: "14.0",
  byteLength: 31_783_744,
  edSignature: `${"A".repeat(86)}==`,
  targetCDHash: "0123456789abcdef0123456789abcdef01234567",
  releaseNotes: "Fixes <b>bold</b> & ]]> \"quotes\"\u0007 and keeps\nlines",
  publishedAt: new Date("2026-11-21T01:02:03.000Z"),
};

describe("renderAppcast", () => {
  it("renders an empty channel when nothing is published", () => {
    const xml = renderAppcast(null, ORIGIN);
    expect(xml).toContain("<channel>");
    expect(xml).not.toContain("<item>");
    expect(xml).toContain('xmlns:nokka="https://nokka-web.vercel.app/ns/updates/v1"');
  });

  it("renders one item with a same-origin enclosure, the signature and the target CDHash", () => {
    const xml = renderAppcast(item, ORIGIN);
    expect(xml.match(/<item>/g)).toHaveLength(1);
    expect(xml).toContain("<sparkle:version>24</sparkle:version>");
    expect(xml).toContain("<sparkle:shortVersionString>2.7.0</sparkle:shortVersionString>");
    expect(xml).toContain("<sparkle:minimumSystemVersion>14.0</sparkle:minimumSystemVersion>");
    expect(xml).toContain("<pubDate>Sat, 21 Nov 2026 01:02:03 +0000</pubDate>");
    expect(xml).toContain(
      `<enclosure url="${ORIGIN}/api/updates/v1/packages/24/Nokka.dmg" length="31783744" type="application/octet-stream" sparkle:edSignature="${item.edSignature}"/>`,
    );
    expect(xml).toContain("<nokka:targetCDHash>0123456789abcdef0123456789abcdef01234567</nokka:targetCDHash>");
  });

  it("escapes plain-text notes and drops characters XML can not hold", () => {
    const xml = renderAppcast(item, ORIGIN);
    expect(xml).toContain(
      '<description sparkle:format="plain-text">Fixes &lt;b&gt;bold&lt;/b&gt; &amp; ]]&gt; &quot;quotes&quot; and keeps\nlines</description>',
    );
    expect(xml).not.toContain("\u0007");
    expect(xml).not.toMatch(/https?:\/\/(?!nokka-web\.vercel\.app|www\.andymatuschak\.org)/);
  });

  it("falls back to the version when there are no notes", () => {
    expect(renderAppcast({ ...item, releaseNotes: "  " }, ORIGIN)).toContain(
      '<description sparkle:format="plain-text">Nokka 2.7.0 (24)</description>',
    );
  });
});
