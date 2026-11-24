// @vitest-environment node
import { createPrivateKey, sign } from "node:crypto";
import { describe, it, expect, vi } from "vitest";
import {
  decodeBase64url,
  generateCode,
  importPublicKey,
  isCode,
  isUuidV4,
  keyedDigest,
  newAccessToken,
  registerMessage,
  sessionMessage,
  verifySignature,
} from "../crypto";
import fixture from "./fixtures/signature-v1.json";

vi.mock("server-only", () => ({}));

const point = Buffer.from(fixture.publicKey, "base64url");
const signatureOf = (value: string) => Buffer.from(value, "base64url");
const privateKey = createPrivateKey({
  key: {
    kty: "EC",
    crv: "P-256",
    d: fixture.privateKeyD,
    x: point.subarray(1, 33).toString("base64url"),
    y: point.subarray(33).toString("base64url"),
  },
  format: "jwk",
});

describe("app/server signature fixture v1", () => {
  it("builds exactly the bytes the app signs", () => {
    const { challengeId, installationId, code } = fixture.register;
    const register = registerMessage(fixture.origin, challengeId, installationId, code);
    expect(register).toBe(fixture.register.message);
    expect(Buffer.from(register, "utf8").toString("base64url")).toBe(fixture.register.messageBase64url);
    expect(register.endsWith("\n")).toBe(false);
    expect(register.split("\n")).toEqual(["nokka-register-v1", "https://nokka-web.vercel.app", challengeId, installationId, "00412345"]);

    const { issuedAt, nonce } = fixture.session;
    const session = sessionMessage(fixture.origin, fixture.session.installationId, issuedAt, nonce);
    expect(session).toBe(fixture.session.message);
    expect(Buffer.from(session, "utf8").toString("base64url")).toBe(fixture.session.messageBase64url);
  });

  it("verifies the fixture signatures with the 65-byte public key", () => {
    expect(point).toHaveLength(65);
    expect(verifySignature(point, fixture.register.message, signatureOf(fixture.register.signature))).toBe(true);
    expect(verifySignature(point, fixture.session.message, signatureOf(fixture.session.signature))).toBe(true);
  });

  it("verifies a fresh r||s signature made the way the app makes it", () => {
    const message = registerMessage(fixture.origin, fixture.register.challengeId, fixture.register.installationId, "99999999");
    const signature = sign("sha256", Buffer.from(message), { key: privateKey, dsaEncoding: "ieee-p1363" });
    expect(signature).toHaveLength(64);
    expect(verifySignature(point, message, signature)).toBe(true);
  });

  it.each([
    ["another origin", fixture.register.message.replace("https://nokka-web.vercel.app", "http://localhost:3000")],
    ["another code", fixture.register.message.replace("00412345", "00412346")],
    ["a trailing LF", `${fixture.register.message}\n`],
    ["CRLF line ends", fixture.register.message.replaceAll("\n", "\r\n")],
    ["the session message", fixture.session.message],
  ])("rejects the register signature over %s", (_, message) => {
    expect(verifySignature(point, message, signatureOf(fixture.register.signature))).toBe(false);
  });

  it("rejects tampered, truncated and DER signatures", () => {
    const tampered = signatureOf(fixture.register.signature);
    tampered[10] ^= 1;
    expect(verifySignature(point, fixture.register.message, tampered)).toBe(false);
    expect(verifySignature(point, fixture.register.message, tampered.subarray(0, 63))).toBe(false);
    const der = sign("sha256", Buffer.from(fixture.register.message), privateKey);
    expect(verifySignature(point, fixture.register.message, der)).toBe(false);
    expect(verifySignature(point, fixture.register.message, Buffer.alloc(64))).toBe(false);
  });
});

describe("input formats", () => {
  it("accepts only lower-case UUID v4", () => {
    expect(isUuidV4(fixture.register.installationId)).toBe(true);
    expect(isUuidV4(fixture.register.installationId.toUpperCase())).toBe(false);
    expect(isUuidV4("0f1e2d3c-4b5a-1968-8776-a5b4c3d2e1f0")).toBe(false);
    expect(isUuidV4(" 0f1e2d3c-4b5a-4968-8776-a5b4c3d2e1f0")).toBe(false);
    expect(isUuidV4(42)).toBe(false);
  });

  it("accepts eight-digit codes with leading zeros only as strings", () => {
    expect(isCode("00000000")).toBe(true);
    expect(isCode("1234567")).toBe(false);
    expect(isCode("123456789")).toBe(false);
    expect(isCode("1234567a")).toBe(false);
    expect(isCode("１２３４５６７８")).toBe(false);
    expect(isCode(12345678)).toBe(false);
  });

  it("decodes only canonical unpadded base64url of the exact length", () => {
    expect(decodeBase64url(fixture.publicKey, 65)).toEqual(point);
    expect(decodeBase64url(`${fixture.publicKey}=`, 65)).toBeNull();
    expect(decodeBase64url(Buffer.from(point).toString("base64"), 65)).toBeNull();
    expect(decodeBase64url(fixture.publicKey.slice(1), 65)).toBeNull();
    expect(decodeBase64url(fixture.publicKey, 64)).toBeNull();
    // "B" and "A" share the leading bits: only the canonical last character is accepted.
    const nonCanonical = `${"A".repeat(42)}B`;
    expect(decodeBase64url(nonCanonical, 32)).toBeNull();
    expect(decodeBase64url(null, 32)).toBeNull();
  });

  it("imports only uncompressed points on the curve", () => {
    expect(importPublicKey(point)).not.toBeNull();
    const offCurve = Buffer.from(point);
    offCurve[64] ^= 1;
    expect(importPublicKey(offCurve)).toBeNull();
    const compressed = Buffer.from(point);
    compressed[0] = 0x02;
    expect(importPublicKey(compressed)).toBeNull();
    expect(importPublicKey(Buffer.alloc(65))).toBeNull();
    expect(importPublicKey(point.subarray(0, 64))).toBeNull();
  });

  it("generates uniform eight-digit codes and 32-byte tokens", () => {
    const codes = Array.from({ length: 200 }, generateCode);
    expect(codes.every(isCode)).toBe(true);
    expect(new Set(codes).size).toBeGreaterThan(190);
    const token = newAccessToken();
    expect(decodeBase64url(token, 32)).not.toBeNull();
    expect(token).not.toBe(newAccessToken());
  });

  it("keeps labelled digests apart", () => {
    expect(keyedDigest("s".repeat(32), "code", "a", "b")).not.toBe(keyedDigest("s".repeat(32), "email", "a", "b"));
    expect(keyedDigest("s".repeat(32), "code", "ab", "c")).not.toBe(keyedDigest("s".repeat(32), "code", "a", "bc"));
    expect(keyedDigest("s".repeat(32), "code", "a")).toMatch(/^[0-9a-f]{64}$/);
  });
});
