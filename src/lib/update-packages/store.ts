import "server-only";
import type { Database } from "@/lib/applications/db";

/** The build the protected feed offers (update_channel.current_build). */
export type FeedItem = {
  build: number;
  shortVersion: string;
  minimumSystemVersion: string;
  byteLength: number;
  edSignature: string;
  targetCDHash: string;
  releaseNotes: string;
  publishedAt: Date;
};

/** What a download needs before any byte is read. */
export type PackageInfo = {
  build: number;
  byteLength: number;
  sha256Hex: string;
  chunkSize: number;
  chunkCount: number;
};

export type PackageStore = {
  /** Null for an empty channel (no channel row yet, or no current build). */
  currentFeedItem(): Promise<FeedItem | null>;
  /** A published (offered and not withdrawn) build, else null. */
  publishedPackage(build: number): Promise<PackageInfo | null>;
  /**
   * `length` bytes of one chunk from `offset` (both within the chunk). Every call is its own short
   * query: a download never holds a transaction or a pooled connection between chunks.
   */
  readChunk(build: number, chunkIndex: number, offset: number, length: number): Promise<Uint8Array | null>;
};

export function createPackageStore(sql: Database): PackageStore {
  return {
    async currentFeedItem() {
      const [row] = await sql<
        {
          build: number;
          short_version: string;
          minimum_system_version: string;
          byte_length: string;
          ed_signature: string;
          target_cdhash: string;
          release_notes: string;
          published_at: Date;
        }[]
      >`
        SELECT p.build, p.short_version, p.minimum_system_version, p.byte_length, p.ed_signature,
               p.target_cdhash, p.release_notes, p.published_at
        FROM update_channel c
        JOIN update_packages p ON p.build = c.current_build AND p.state = 'published'
      `;
      if (!row) return null;
      return {
        build: row.build,
        shortVersion: row.short_version,
        minimumSystemVersion: row.minimum_system_version,
        byteLength: Number(row.byte_length),
        edSignature: row.ed_signature,
        targetCDHash: row.target_cdhash,
        releaseNotes: row.release_notes,
        publishedAt: row.published_at,
      };
    },

    async publishedPackage(build) {
      const [row] = await sql<
        { build: number; byte_length: string; sha256: Buffer; chunk_size: number; chunk_count: number }[]
      >`
        SELECT build, byte_length, sha256, chunk_size, chunk_count
        FROM update_packages
        WHERE build = ${build} AND state = 'published'
      `;
      if (!row) return null;
      return {
        build: row.build,
        byteLength: Number(row.byte_length),
        sha256Hex: Buffer.from(row.sha256).toString("hex"),
        chunkSize: row.chunk_size,
        chunkCount: row.chunk_count,
      };
    },

    async readChunk(build, chunkIndex, offset, length) {
      const [row] = await sql<{ data: Buffer }[]>`
        SELECT substring(data FROM ${offset + 1}::int FOR ${length}::int) AS data
        FROM update_package_chunks
        WHERE build = ${build} AND chunk_index = ${chunkIndex}
      `;
      return row ? new Uint8Array(row.data.buffer, row.data.byteOffset, row.data.byteLength) : null;
    },
  };
}
