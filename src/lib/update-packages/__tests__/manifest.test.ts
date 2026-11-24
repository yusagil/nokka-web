// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseManifest } from "../../../../scripts/update-packages.mjs";

// The shape the app's scripts/release/make-protected-package.sh writes (its test asserts the same object).
const MANIFEST = {
  format: "nokka-update-package-v1",
  build: 24,
  version: "2.7.1",
  minimumSystemVersion: "14.0",
  length: 5000,
  sha256: "a".repeat(64),
  edSignature: `${"S".repeat(86)}==`,
  targetCDHash: "0123456789abcdef0123456789abcdef01234567",
  notes: "Fixes the export.\n\tTabs stay.",
};

describe("parseManifest", () => {
  it("accepts what make-protected-package.sh writes", () => {
    expect(parseManifest(JSON.stringify(MANIFEST))).toEqual(MANIFEST);
  });

  it("refuses anything else before the database is touched", () => {
    const variants: [string, unknown][] = [
      ["not json", "{"],
      ["extra key", { ...MANIFEST, url: "https://example.com/Nokka.dmg" }],
      ["missing key", { ...MANIFEST, notes: undefined }],
      ["format", { ...MANIFEST, format: "v2" }],
      ["legacy build", { ...MANIFEST, build: 22 }],
      ["build type", { ...MANIFEST, build: "24" }],
      ["version", { ...MANIFEST, version: "2.7.1-beta" }],
      ["system", { ...MANIFEST, minimumSystemVersion: "fourteen" }],
      ["length", { ...MANIFEST, length: 0 }],
      ["sha256", { ...MANIFEST, sha256: "A".repeat(64) }],
      ["signature", { ...MANIFEST, edSignature: "short==" }],
      ["cdhash", { ...MANIFEST, targetCDHash: "0123456789ABCDEF0123456789ABCDEF01234567" }],
      ["notes control", { ...MANIFEST, notes: "bell \u0007" }],
      ["notes size", { ...MANIFEST, notes: "x".repeat(20001) }],
    ];
    for (const [label, value] of variants) {
      expect(() => parseManifest(typeof value === "string" ? value : JSON.stringify(value)), label).toThrow();
    }
  });
});
