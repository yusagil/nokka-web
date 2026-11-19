import "server-only";

export function isJsonContentType(value: string | null): boolean {
  return value?.split(";")[0].trim().toLowerCase() === "application/json";
}

export type JsonBody = { ok: true; value: unknown } | { ok: false; reason: "TOO_LARGE" | "INVALID" };

/**
 * Reads at most `maxBytes` (declared Content-Length and actual stream both count) and parses them as
 * UTF-8 JSON. INVALID covers undecodable bytes, an empty body and malformed JSON.
 */
export async function readJsonBody(request: Request, maxBytes: number): Promise<JsonBody> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, reason: "TOO_LARGE" };
  if (!request.body) return { ok: false, reason: "INVALID" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return { ok: false, reason: "TOO_LARGE" };
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) };
  } catch {
    return { ok: false, reason: "INVALID" };
  }
}

/** A plain JSON object whose keys are all in `allowed`, else null. */
export function asObjectWithKeys(
  value: unknown,
  allowed: readonly string[],
): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return Object.keys(value).every((key) => allowed.includes(key))
    ? (value as Record<string, unknown>)
    : null;
}
