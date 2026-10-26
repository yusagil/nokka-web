import { describe, it, expect } from "vitest";
import en from "../en.json";
import ko from "../ko.json";
import { DOWNLOAD_URL } from "@/lib/links";

/** Every key path with its value type, and array lengths, so en and ko stay in step. */
function shape(value: unknown, path = ""): string[] {
  if (Array.isArray(value)) {
    return [`${path}[${value.length}]`, ...value.flatMap((v, i) => shape(v, `${path}[${i}]`))];
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => shape(v, path ? `${path}.${k}` : k));
  }
  return [`${path}:${typeof value}`];
}

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

const all = [...strings(en), ...strings(ko)].join("\n");

describe("dictionaries", () => {
  it("en and ko have the same structure", () => {
    expect(shape(ko)).toEqual(shape(en));
  });

  it("make no blanket privacy claims", () => {
    for (const phrase of [
      /100%/,
      /클라우드 없음/,
      /계정 불필요/,
      /no cloud/i,
      /no account/i,
      /never leaves?/i,
    ]) {
      expect(all).not.toMatch(phrase);
    }
  });

  it("do not mention removed or unsupported things", () => {
    expect(all).not.toMatch(/clova/i);
    expect(all).not.toMatch(/Apple Silicon & Intel/i);
    expect(all).not.toMatch(/무료|\bfree\b/i);
  });

  it("describe speaker naming as the in-window row, not a dropdown menu", () => {
    expect(all).not.toMatch(/드롭다운|drop-?down/i);
  });

  it("do not hard-code a build number or checksum", () => {
    expect(all).not.toMatch(/\b[0-9a-f]{64}\b/);
    expect(all).not.toMatch(/2\.1\.0|\(11\)|\(12\)/);
  });

  it("the download URL follows the latest release", () => {
    expect(DOWNLOAD_URL).toBe(
      "https://github.com/yusagil/nokka-web/releases/latest/download/Nokka.dmg"
    );
  });
});
