import { describe, it, expect } from "vitest";
import { copy } from "../copy";
import { composeMailto, formatDateTime } from "../format";

describe("formatDateTime", () => {
  it("shows Seoul time", () => {
    expect(formatDateTime("2026-11-19T12:30:00.000Z")).toMatch(/2026\. 11\. 19\. 21:30/);
  });

  it("returns unparseable input unchanged", () => {
    expect(formatDateTime("not a date")).toBe("not a date");
  });
});

describe("composeMailto", () => {
  it("fills the recipient, subject and a short draft addressed by name", () => {
    const url = new URL(composeMailto("김테스트", "kim@example.com"));
    expect(url.protocol).toBe("mailto:");
    expect(url.pathname).toBe("kim@example.com");
    expect(url.searchParams.get("subject")).toBe(copy.mailSubject);
    expect(url.searchParams.get("body")).toBe(copy.mailBody("김테스트"));
    expect(copy.mailBody("김테스트")).toMatch(/^김테스트님/);
  });

  it("encodes characters that would break the link", () => {
    const url = composeMailto("A", "a?b&c#d@example.com");
    expect(url.startsWith("mailto:a%3Fb%26c%23d@example.com?subject=")).toBe(true);
  });

  it("promises no price, release date or download in the draft", () => {
    expect(`${copy.mailSubject}\n${copy.mailBody("A")}`).not.toMatch(/가격|요금|출시|다운로드|DMG|무료/);
  });
});
