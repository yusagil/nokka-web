import { describe, it, expect } from "vitest";
import { EMAIL_MAX_LENGTH, NAME_MAX_LENGTH } from "../contracts";
import { validateApplication } from "../validation";

const LINE_SEPARATOR = String.fromCharCode(0x2028);

describe("validateApplication", () => {
  it("trims both fields and accepts ordinary names", () => {
    expect(validateApplication({ name: "  홍 길동  ", email: " qa@example.com " })).toEqual({
      ok: true,
      value: { name: "홍 길동", email: "qa@example.com" },
    });
    for (const name of ["Mary-Jane O'Neil", "李 小龍", "A"]) {
      expect(validateApplication({ name, email: "qa@example.com" }).ok).toBe(true);
    }
  });

  it("reports empty or whitespace-only fields as REQUIRED", () => {
    expect(validateApplication({ name: "   ", email: "" })).toEqual({
      ok: false,
      fieldErrors: { name: "REQUIRED", email: "REQUIRED" },
    });
  });

  it("enforces maximum lengths after trimming", () => {
    const maxName = "가".repeat(NAME_MAX_LENGTH);
    expect(validateApplication({ name: ` ${maxName} `, email: "qa@example.com" }).ok).toBe(true);
    expect(validateApplication({ name: `${maxName}a`, email: "qa@example.com" })).toEqual({
      ok: false,
      fieldErrors: { name: "TOO_LONG" },
    });

    const domain = "@example.com";
    const maxEmail = "a".repeat(EMAIL_MAX_LENGTH - domain.length) + domain;
    expect(validateApplication({ name: "QA", email: maxEmail }).ok).toBe(true);
    expect(validateApplication({ name: "QA", email: `a${maxEmail}` })).toEqual({
      ok: false,
      fieldErrors: { email: "TOO_LONG" },
    });
  });

  it("rejects newlines and control characters in the name", () => {
    for (const name of ["QA\nTest", "QA\tTest", "QA\u0000", `QA${LINE_SEPARATOR}Test`]) {
      expect(validateApplication({ name, email: "qa@example.com" })).toEqual({
        ok: false,
        fieldErrors: { name: "INVALID" },
      });
    }
  });

  it("rejects malformed emails", () => {
    const invalid = [
      "plainaddress",
      "@example.com",
      "qa@",
      "qa@example",
      "qa@@example.com",
      "qa@exa mple.com",
      "qa@example..com",
      "qa@.example.com",
      "qa@example.com.",
      "q a@example.com",
      "qa\u0000@example.com",
    ];
    for (const email of invalid) {
      expect(validateApplication({ name: "QA", email }), email).toEqual({
        ok: false,
        fieldErrors: { email: "INVALID" },
      });
    }
  });

  it("accepts common email shapes without folding them", () => {
    for (const email of ["First.Last+tag@Example.co.kr", "a@b.io", "qa_1@sub.example.com"]) {
      expect(validateApplication({ name: "QA", email })).toEqual({
        ok: true,
        value: { name: "QA", email },
      });
    }
  });
});
