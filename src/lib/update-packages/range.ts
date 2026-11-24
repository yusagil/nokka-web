/** Inclusive byte positions of a single satisfiable range. */
export type ByteRange = { start: number; end: number };

export type RangeRequest =
  | { kind: "full" }
  | { kind: "partial"; range: ByteRange }
  | { kind: "unsatisfiable" };

const SINGLE_RANGE = /^bytes=(\d*)-(\d*)$/i;
const MAX_DIGITS = 15; // well inside Number.MAX_SAFE_INTEGER

/**
 * Reads a `Range` header for a representation of `size` bytes (RFC 9110 §14). Only one byte range is
 * served: a closed (`a-b`), open (`a-`) or suffix (`-n`) range. A multi-range, another unit, a malformed
 * value or a range that starts at or after the end is unsatisfiable (416 with `bytes *\/size`). An end
 * past the last byte is clipped to it.
 */
export function parseRange(header: string | null, size: number): RangeRequest {
  if (header === null) return { kind: "full" };
  const match = SINGLE_RANGE.exec(header.trim());
  if (!match) return { kind: "unsatisfiable" };
  const [, first, last] = match;
  if (first.length > MAX_DIGITS || last.length > MAX_DIGITS) return { kind: "unsatisfiable" };

  if (first === "") {
    if (last === "") return { kind: "unsatisfiable" };
    const suffix = Number(last);
    if (suffix === 0 || size === 0) return { kind: "unsatisfiable" };
    return { kind: "partial", range: { start: Math.max(0, size - suffix), end: size - 1 } };
  }

  const start = Number(first);
  if (start >= size) return { kind: "unsatisfiable" };
  if (last === "") return { kind: "partial", range: { start, end: size - 1 } };
  const end = Number(last);
  if (end < start) return { kind: "unsatisfiable" };
  return { kind: "partial", range: { start, end: Math.min(end, size - 1) } };
}

/** `If-Range` keeps the range only when it names the current strong validator. */
export function rangeStillValid(ifRange: string | null, etag: string): boolean {
  return ifRange === null || ifRange.trim() === etag;
}

/** `If-None-Match` lists `etag` (weak comparison) or is `*`. */
export function matchesIfNoneMatch(ifNoneMatch: string | null, etag: string): boolean {
  if (ifNoneMatch === null) return false;
  const opaque = etag.replace(/^W\//, "");
  return ifNoneMatch
    .split(",")
    .map((tag) => tag.trim())
    .some((tag) => tag === "*" || tag.replace(/^W\//, "") === opaque);
}
