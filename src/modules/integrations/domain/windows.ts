export const DAY_MS = 86_400_000;
/** PayPal accepts at most 31 days per request; Stripe has no such limit, but one rule keeps the sync resumable. */
export const WINDOW_DAYS = 31;
/** Each sync starts this far before its cursor: a late-arriving record (PayPal can take 3 hours) is picked up, and the import is idempotent. */
export const OVERLAP_MS = 2 * DAY_MS;

export type Window = { from: Date; to: Date };

/** Where to start: the first day the person asked for, or the cursor minus the overlap, whichever is later. */
export function syncStart(importFrom: string, cursor: Date | null): Date {
  const first = new Date(`${importFrom}T00:00:00Z`);
  if (!cursor) return first;
  const resumed = new Date(cursor.getTime() - OVERLAP_MS);
  return resumed > first ? resumed : first;
}

/** Consecutive windows of at most WINDOW_DAYS from `start` to `end`, oldest first. */
export function windows(start: Date, end: Date, maxWindows: number): Window[] {
  const out: Window[] = [];
  let from = start;
  while (from < end && out.length < maxWindows) {
    const to = new Date(Math.min(from.getTime() + WINDOW_DAYS * DAY_MS, end.getTime()));
    out.push({ from, to });
    from = to;
  }
  return out;
}
