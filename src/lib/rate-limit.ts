import { one, run, sql, now } from "./db";

/**
 * Fixed-window counter in the database (survives restarts, works across processes).
 * Returns false once `limit` hits inside the window have been consumed. One atomic statement:
 * concurrent requests can't both slip under the limit.
 */
export async function consume(key: string, limit: number, windowSec: number): Promise<boolean> {
  const t = now();
  const r = await one<{ count: number }>(
    sql`INSERT INTO rate_limits(key, count, reset_at) VALUES (${key}, 1, ${t + windowSec})
        ON CONFLICT (key) DO UPDATE SET
          count = CASE WHEN rate_limits.reset_at <= ${t} THEN 1 ELSE rate_limits.count + 1 END,
          reset_at = CASE WHEN rate_limits.reset_at <= ${t} THEN excluded.reset_at ELSE rate_limits.reset_at END
        RETURNING count`,
  );
  return (r?.count ?? 1) <= limit;
}

export async function purgeRateLimits() {
  await run(sql`DELETE FROM rate_limits WHERE reset_at <= ${now()}`);
}

/** Read-only check: has `key` already reached `limit` inside its current window? */
export async function isBlocked(key: string, limit: number): Promise<boolean> {
  const row = await one<{ count: number; reset_at: number }>(
    sql`SELECT count, reset_at FROM rate_limits WHERE key = ${key}`,
  );
  return !!row && row.reset_at > now() && row.count >= limit;
}

/** Count one failure; the window starts with the first failure. */
export async function recordFailure(key: string, windowSec: number) {
  const t = now();
  await run(
    sql`INSERT INTO rate_limits(key, count, reset_at) VALUES (${key}, 1, ${t + windowSec})
        ON CONFLICT (key) DO UPDATE SET
          count = CASE WHEN rate_limits.reset_at <= ${t} THEN 1 ELSE rate_limits.count + 1 END,
          reset_at = CASE WHEN rate_limits.reset_at <= ${t} THEN excluded.reset_at ELSE rate_limits.reset_at END`,
  );
}

export async function clearKey(key: string) {
  await run(sql`DELETE FROM rate_limits WHERE key = ${key}`);
}
