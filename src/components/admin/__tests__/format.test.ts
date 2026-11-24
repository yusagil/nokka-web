import { describe, it, expect } from "vitest";
import { copy } from "../copy";
import {
  composeGmail,
  composeInstallLinkGmail,
  composeInstallLinkMailto,
  composeMailto,
  formatDateTime,
  installLinkMailBody,
} from "../format";

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

describe("composeGmail", () => {
  it("opens the same draft in Gmail's compose window", () => {
    const url = new URL(composeGmail("김테스트", "kim@example.com"));
    expect(url.origin).toBe("https://mail.google.com");
    expect(url.pathname).toBe("/mail/");
    expect(url.searchParams.get("view")).toBe("cm");
    expect(url.searchParams.get("fs")).toBe("1");
    expect(url.searchParams.get("to")).toBe("kim@example.com");
    expect(url.searchParams.get("su")).toBe(copy.mailSubject);
    expect(url.searchParams.get("body")).toBe(copy.mailBody("김테스트"));
  });

  it("keeps spaces, line breaks and a plus-addressed recipient intact", () => {
    const url = composeGmail("A B", "a+b&c#d@example.com");
    // "+" would be read as a space, so spaces are %20 and a "+" in the address is %2B.
    expect(url).not.toContain("+");
    expect(url).toContain("to=a%2Bb%26c%23d%40example.com&");
    expect(url).toContain("A%20B");
    expect(new URL(url).searchParams.get("body")).toBe(copy.mailBody("A B"));
  });
});

describe("install-link drafts", () => {
  const install = `https://nokka-web.vercel.app/install#${"a".repeat(42)}A`;
  const expiresAt = "2026-11-26T03:30:00.000Z";

  it("keep the link out of both compose addresses", () => {
    const gmail = new URL(composeInstallLinkGmail("kim@example.com"));
    expect(gmail.searchParams.get("to")).toBe("kim@example.com");
    expect(gmail.searchParams.get("su")).toBe(copy.installLinkMailSubject);
    expect(gmail.searchParams.has("body")).toBe(false);
    const mail = new URL(composeInstallLinkMailto("kim@example.com"));
    expect(mail.pathname).toBe("kim@example.com");
    expect(mail.searchParams.get("subject")).toBe(copy.installLinkMailSubject);
    expect(mail.searchParams.has("body")).toBe(false);
  });

  it("put the link and its Seoul-time expiry in the body that is copied", () => {
    const body = installLinkMailBody("김테스트", install, expiresAt);
    expect(body).toBe(copy.installLinkMailBody("김테스트", install, "2026. 11. 26. 12:30"));
    expect(body).toContain(install);
  });
});
