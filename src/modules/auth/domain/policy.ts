// Authentication policy constants and pure helpers (no I/O).

export const SESSION_IDLE_MS = 8 * 60 * 60 * 1000; // signed out after 8 h without activity
export const SESSION_ABSOLUTE_MS = 14 * 24 * 60 * 60 * 1000; // and after 14 days whatever happens
export const MFA_PENDING_MS = 10 * 60 * 1000; // password-only sessions must finish MFA within 10 minutes
export const SESSION_TOUCH_MS = 5 * 60 * 1000; // last_seen_at is refreshed at most every 5 min

export const LOCK_AFTER_FAILURES = 10;
export const LOCK_MS = 15 * 60 * 1000;

/** Fixed-window rate limits (key prefix -> max hits per window). */
export const RATE_LIMITS = {
  loginIp: { max: 30, windowSeconds: 15 * 60 },
  loginEmail: { max: 8, windowSeconds: 15 * 60 },
  mfaUser: { max: 8, windowSeconds: 15 * 60 },
  setupIp: { max: 10, windowSeconds: 60 * 60 },
} as const;

export type SessionRow = { createdAt: Date; lastSeenAt: Date; expiresAt: Date };

export function sessionIsValid(session: SessionRow, now: Date): boolean {
  return (
    now.getTime() < session.expiresAt.getTime() &&
    now.getTime() < session.createdAt.getTime() + SESSION_ABSOLUTE_MS &&
    now.getTime() < session.lastSeenAt.getTime() + SESSION_IDLE_MS
  );
}

export function sessionExpiry(now: Date): Date {
  return new Date(now.getTime() + SESSION_ABSOLUTE_MS);
}

/** Lock the account once `failedCount` (already incremented) reaches the threshold. */
export function lockedUntil(failedCount: number, now: Date): Date | null {
  return failedCount >= LOCK_AFTER_FAILURES ? new Date(now.getTime() + LOCK_MS) : null;
}

/** Signed in for real: no second factor required, or second factor done for this session. */
export function isFullySignedIn(state: { totpEnabled: boolean; mfaVerifiedAt: Date | null }): boolean {
  return !state.totpEnabled || state.mfaVerifiedAt !== null;
}
