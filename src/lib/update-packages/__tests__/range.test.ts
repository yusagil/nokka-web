// @vitest-environment node
import { describe, expect, it } from "vitest";
import { matchesIfNoneMatch, parseRange, rangeStillValid } from "../range";

const SIZE = 31_783_744;

describe("parseRange", () => {
  it("serves the whole file without a Range header", () => {
    expect(parseRange(null, SIZE)).toEqual({ kind: "full" });
  });

  it("reads closed, open and suffix ranges and clips an end past the file", () => {
    expect(parseRange("bytes=0-1023", SIZE)).toEqual({ kind: "partial", range: { start: 0, end: 1023 } });
    expect(parseRange("bytes=100-", SIZE)).toEqual({ kind: "partial", range: { start: 100, end: SIZE - 1 } });
    expect(parseRange("bytes=-1", SIZE)).toEqual({ kind: "partial", range: { start: SIZE - 1, end: SIZE - 1 } });
    expect(parseRange("bytes=-99999999", SIZE)).toEqual({ kind: "partial", range: { start: 0, end: SIZE - 1 } });
    expect(parseRange(`bytes=${SIZE - 1}-${SIZE + 10}`, SIZE)).toEqual({
      kind: "partial",
      range: { start: SIZE - 1, end: SIZE - 1 },
    });
    expect(parseRange("BYTES=5-5", SIZE)).toEqual({ kind: "partial", range: { start: 5, end: 5 } });
  });

  it("refuses ranges it can not satisfy or does not serve", () => {
    for (const header of [
      `bytes=${SIZE}-`,
      `bytes=${SIZE}-${SIZE + 1}`,
      "bytes=-0",
      "bytes=10-5",
      "bytes=0-1,5-9",
      "bytes=-",
      "bytes=a-b",
      "bytes= 0-1",
      "items=0-1",
      "bytes=1234567890123456-",
      "",
    ]) {
      expect(parseRange(header, SIZE), header).toEqual({ kind: "unsatisfiable" });
    }
  });
});

describe("validators", () => {
  const etag = '"abc"';
  it("keeps a range only for the current ETag", () => {
    expect(rangeStillValid(null, etag)).toBe(true);
    expect(rangeStillValid('"abc"', etag)).toBe(true);
    expect(rangeStillValid('"old"', etag)).toBe(false);
    expect(rangeStillValid("Sat, 21 Nov 2026 00:00:00 GMT", etag)).toBe(false);
  });

  it("matches If-None-Match lists, weak tags and *", () => {
    expect(matchesIfNoneMatch(null, etag)).toBe(false);
    expect(matchesIfNoneMatch('"x", "abc"', etag)).toBe(true);
    expect(matchesIfNoneMatch('W/"abc"', etag)).toBe(true);
    expect(matchesIfNoneMatch("*", etag)).toBe(true);
    expect(matchesIfNoneMatch('"x"', etag)).toBe(false);
  });
});
