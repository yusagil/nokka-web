import "server-only";
import {
  createHash,
  createHmac,
  createPublicKey,
  randomBytes,
  randomInt,
  verify,
  type KeyObject,
} from "node:crypto";
import { CODE_LENGTH, REGISTER_MESSAGE_TAG, SESSION_MESSAGE_TAG } from "./contracts";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BASE64URL = /^[A-Za-z0-9_-]*$/;
const CODE = new RegExp(`^\\d{${CODE_LENGTH}}$`);

export const PUBLIC_KEY_BYTES = 65;
export const SIGNATURE_BYTES = 64;
export const NONCE_BYTES = 32;
export const TOKEN_BYTES = 32;

/** Lower-case UUID version 4, as the app and the server both generate ids. */
export function isUuidV4(value: unknown): value is string {
  return typeof value === "string" && UUID_V4.test(value);
}

export function isCode(value: unknown): value is string {
  return typeof value === "string" && CODE.test(value);
}

/** Unpadded base64url of exactly `bytes` bytes in its one canonical spelling, else null. */
export function decodeBase64url(value: unknown, bytes: number): Buffer | null {
  if (typeof value !== "string" || !BASE64URL.test(value)) return null;
  if (value.length !== Math.ceil((bytes * 4) / 3)) return null;
  const decoded = Buffer.from(value, "base64url");
  return decoded.length === bytes && decoded.toString("base64url") === value ? decoded : null;
}

/** A P-256 public key from its X9.63 uncompressed point; null unless the point is on the curve. */
export function importPublicKey(point: Buffer): KeyObject | null {
  if (point.length !== PUBLIC_KEY_BYTES || point[0] !== 0x04) return null;
  try {
    return createPublicKey({
      key: {
        kty: "EC",
        crv: "P-256",
        x: point.subarray(1, 33).toString("base64url"),
        y: point.subarray(33).toString("base64url"),
      },
      format: "jwk",
    });
  } catch {
    return null;
  }
}

/** UTF-8 lines joined by a single LF, no trailing LF (the exact bytes the app signs). */
export function registerMessage(origin: string, challengeId: string, installationId: string, code: string) {
  return [REGISTER_MESSAGE_TAG, origin, challengeId, installationId, code].join("\n");
}

export function sessionMessage(origin: string, installationId: string, issuedAt: number, nonce: string) {
  return [SESSION_MESSAGE_TAG, origin, installationId, String(issuedAt), nonce].join("\n");
}

/** ECDSA P-256 / SHA-256 over the UTF-8 message; the signature is r||s, 32 bytes each, big endian. */
export function verifySignature(point: Buffer, message: string, signature: Buffer): boolean {
  const key = importPublicKey(point);
  if (!key || signature.length !== SIGNATURE_BYTES) return false;
  try {
    return verify("sha256", Buffer.from(message, "utf8"), { key, dsaEncoding: "ieee-p1363" }, signature);
  } catch {
    return false;
  }
}

/** Eight uniformly random digits (leading zeros kept). */
export function generateCode(): string {
  return String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, "0");
}

/** Hex HMAC-SHA256 of the labelled parts; labels keep one secret's uses apart. */
export function keyedDigest(secret: string, label: string, ...parts: string[]): string {
  const mac = createHmac("sha256", secret).update(label);
  for (const part of parts) mac.update("\n").update(part);
  return mac.digest("hex");
}

export function newAccessToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/** Stored instead of the token or the nonce: 32 bytes of SHA-256. */
export function sha256(value: string | Buffer): Buffer {
  return createHash("sha256").update(value).digest();
}
