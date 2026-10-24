import "server-only";
import { withAnonymous, withUser } from "@/platform/tenant";
import { isFullySignedIn, sessionExpiry, sessionIsValid, SESSION_TOUCH_MS, MFA_PENDING_MS } from "../domain/policy";
import { newToken, sha256Hex } from "./crypto";

export type SessionInfo = {
  userId: string;
  /** Password accepted, second factor still to do. */
  mfaPending: boolean;
  expiresAt: Date;
};

export async function createSession(userId: string, userAgent: string | null, now = new Date()): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken();
  const expiresAt = sessionExpiry(now);
  await withUser({ userId }, (tx) =>
    tx.session.create({
      data: {
        id: sha256Hex(token),
        userId,
        createdAt: now,
        lastSeenAt: now,
        expiresAt,
        userAgent: userAgent?.slice(0, 256) ?? null,
      },
    }),
  );
  return { token, expiresAt };
}

/** Finds the session of a cookie token, or null (unknown, expired, disabled account). */
export async function resolveSession(token: string | undefined, now = new Date()): Promise<SessionInfo | null> {
  if (!token || token.length < 20 || token.length > 128) return null;
  const id = sha256Hex(token);
  const rows = await withAnonymous(
    (tx) =>
      tx.$queryRaw<
        {
          user_id: string;
          created_at: Date;
          last_seen_at: Date;
          expires_at: Date;
          mfa_verified_at: Date | null;
          totp_enabled: boolean;
          disabled: boolean;
        }[]
      >`SELECT * FROM auth_session_lookup(${id})`,
  );
  const row = rows[0];
  if (!row || row.disabled) return null;
  const valid = sessionIsValid({ createdAt: row.created_at, lastSeenAt: row.last_seen_at, expiresAt: row.expires_at }, now);
  if (!valid || (row.totp_enabled && !row.mfa_verified_at && now.getTime() >= row.created_at.getTime() + MFA_PENDING_MS)) {
    await withUser({ userId: row.user_id }, (tx) => tx.session.deleteMany({ where: { id } }));
    return null;
  }
  if (now.getTime() - row.last_seen_at.getTime() > SESSION_TOUCH_MS) {
    await withUser({ userId: row.user_id }, (tx) => tx.session.updateMany({ where: { id }, data: { lastSeenAt: now } }));
  }
  return {
    userId: row.user_id,
    mfaPending: !isFullySignedIn({ totpEnabled: row.totp_enabled, mfaVerifiedAt: row.mfa_verified_at }),
    expiresAt: row.expires_at,
  };
}

export async function destroySession(userId: string, token: string): Promise<void> {
  await withUser({ userId }, (tx) => tx.session.deleteMany({ where: { id: sha256Hex(token) } }));
}
