import { all, one, run, sql, tx, now } from "./db";

/**
 * Escalating sign-in lock-out. Every time an account (or an unknown sign-in name) reaches the
 * failure limit inside FAIL_WINDOW, it is locked for the next step of the ladder:
 * 10 min → 20 min → 1 h → 3 h → 6 h → 12 h → 24 h (stays at 24 h).
 * A successful sign-in or an administrator unlock resets everything; after a full day without
 * a new lock the ladder starts again from the first step.
 */
import { LADDER } from "./lockout-ladder";
export { LADDER };
const FAIL_WINDOW = 15 * 60;
const LEVEL_DECAY = 24 * 3600;

type Row = {
  key: string;
  user_id: number | null;
  fails: number;
  window_start: number;
  level: number;
  locked_until: number;
};

export const userKey = (userId: number) => `fail:u:${userId}`;
export const nameKey = (ident: string) => `fail:id:${ident.toLowerCase().slice(0, 80)}`;

/** Seconds left on an active lock, or 0. */
export async function lockedFor(key: string): Promise<number> {
  const r = await one<{ locked_until: number }>(sql`SELECT locked_until FROM lockouts WHERE key = ${key}`);
  return r ? Math.max(0, r.locked_until - now()) : 0;
}

/** Counts one failure. Returns the new lock duration in seconds when this failure triggered a lock. */
export function registerFailure(key: string, maxAttempts: number, userId: number | null): Promise<number | null> {
  return tx(async () => {
    const t = now();
    const r = await one<Row>(sql`SELECT * FROM lockouts WHERE key = ${key}`);
    let fails = 1,
      windowStart = t,
      level = 0;
    if (r) {
      level = r.level;
      if (r.locked_until > 0 && t - r.locked_until > LEVEL_DECAY) level = 0;
      if (t - r.window_start <= FAIL_WINDOW) {
        fails = r.fails + 1;
        windowStart = r.window_start;
      }
    }
    let lockedUntil = r?.locked_until ?? 0,
      duration: number | null = null;
    if (fails >= maxAttempts) {
      level = Math.min(level + 1, LADDER.length);
      duration = LADDER[level - 1];
      lockedUntil = t + duration;
      fails = 0;
      windowStart = t;
    }
    await run(
      sql`INSERT INTO lockouts(key, user_id, fails, window_start, level, locked_until)
          VALUES (${key}, ${userId}, ${fails}, ${windowStart}, ${level}, ${lockedUntil})
          ON CONFLICT (key) DO UPDATE SET user_id = excluded.user_id, fails = excluded.fails,
            window_start = excluded.window_start, level = excluded.level, locked_until = excluded.locked_until`,
    );
    return duration;
  });
}

export async function clearLock(key: string) {
  await run(sql`DELETE FROM lockouts WHERE key = ${key}`);
}

/** Active locks per user id (for the admin overview). */
export async function activeUserLocks(): Promise<Map<number, number>> {
  const rows = await all<{ user_id: number; locked_until: number }>(
    sql`SELECT user_id, locked_until FROM lockouts WHERE user_id IS NOT NULL AND locked_until > ${now()}`,
  );
  return new Map(rows.map((r) => [r.user_id, r.locked_until]));
}

export async function purgeLockouts() {
  await run(
    sql`DELETE FROM lockouts WHERE locked_until < ${now() - LEVEL_DECAY} AND window_start < ${now() - LEVEL_DECAY}`,
  );
}
