import "server-only";
import { withAnonymous } from "@/platform/tenant";
import { rateLimitKey } from "./crypto";

export type RateLimit = { max: number; windowSeconds: number };

const PURGE_PROBABILITY = 0.01;

/**
 * Fixed-window counter in PostgreSQL (no Redis). The key is a keyed hash: IPs and e-mail
 * addresses are never stored. Runs in its own transaction so a failed attempt still counts.
 */
export async function hit(scope: string, subject: string, limit: RateLimit): Promise<{ allowed: boolean; count: number }> {
  const key = `${scope}:${rateLimitKey(subject)}`;
  const rows = await withAnonymous((tx) =>
    tx.$queryRaw<{ count: number }[]>`
      INSERT INTO rate_limit (key, window_start, count) VALUES (${key}, now(), 1)
      ON CONFLICT (key) DO UPDATE SET
        window_start = CASE WHEN rate_limit.window_start < now() - make_interval(secs => ${limit.windowSeconds}::int)
                            THEN now() ELSE rate_limit.window_start END,
        count = CASE WHEN rate_limit.window_start < now() - make_interval(secs => ${limit.windowSeconds}::int)
                     THEN 1 ELSE rate_limit.count + 1 END
      RETURNING count`,
  );
  const count = rows[0]?.count ?? 1;
  // Housekeeping without a scheduler: about one request in a hundred forgets the old windows.
  if (Math.random() < PURGE_PROBABILITY) void purgeOldWindows().catch(() => undefined);
  return { allowed: count <= limit.max, count };
}

/** Housekeeping: forget windows that ended long ago. */
export async function purgeOldWindows(): Promise<void> {
  await withAnonymous((tx) => tx.$executeRaw`DELETE FROM rate_limit WHERE window_start < now() - interval '1 day'`);
}
