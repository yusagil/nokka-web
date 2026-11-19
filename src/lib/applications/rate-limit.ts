import "server-only";
import { createHmac } from "node:crypto";
import type { Database } from "./db";

export const RATE_LIMIT_MAX_REQUESTS = 10;
export const RATE_LIMIT_WINDOW_SECONDS = 10 * 60;

export type RateLimitDecision =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

export type RateLimiter = {
  consume(clientKey: string): Promise<RateLimitDecision>;
};

type RateLimitOptions = { limit?: number; windowSeconds?: number };

/**
 * Fixed-window counter shared by every server instance through the database. Keys are an HMAC of
 * the client IP, so the table never holds raw addresses.
 */
export function createRateLimiter(
  sql: Database,
  secret: string,
  { limit = RATE_LIMIT_MAX_REQUESTS, windowSeconds = RATE_LIMIT_WINDOW_SECONDS }: RateLimitOptions = {},
): RateLimiter {
  return {
    async consume(clientKey) {
      const keyHash = createHmac("sha256", secret).update(clientKey).digest("hex");

      await sql`
        DELETE FROM application_rate_limits
        WHERE window_started_at <= now() - make_interval(secs => ${windowSeconds})
      `;
      const [row] = await sql<{ request_count: number; retry_after: number }[]>`
        INSERT INTO application_rate_limits AS r (key_hash, window_started_at, request_count)
        VALUES (${keyHash}, now(), 1)
        ON CONFLICT (key_hash) DO UPDATE SET
          window_started_at = CASE
            WHEN r.window_started_at <= now() - make_interval(secs => ${windowSeconds}) THEN now()
            ELSE r.window_started_at
          END,
          request_count = CASE
            WHEN r.window_started_at <= now() - make_interval(secs => ${windowSeconds}) THEN 1
            ELSE r.request_count + 1
          END
        RETURNING
          r.request_count,
          ceil(extract(epoch FROM r.window_started_at + make_interval(secs => ${windowSeconds}) - now()))::int
            AS retry_after
      `;

      if (row.request_count <= limit) return { allowed: true };
      return { allowed: false, retryAfterSeconds: Math.max(1, row.retry_after) };
    },
  };
}
