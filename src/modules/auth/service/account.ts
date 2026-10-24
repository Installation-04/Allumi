import "server-only";
import { recordEvent } from "@/modules/audit";
import { withUser } from "@/platform/tenant";
import { checkPassword, type PasswordProblem } from "../domain/password";
import { MFA_PENDING_MS, RATE_LIMITS, sessionIsValid } from "../domain/policy";
import { describeUserAgent, type DeviceLabel } from "../domain/user-agent";
import { hashPassword, sha256Hex, verifyPassword } from "./crypto";
import { hit } from "./rate-limit";
import { closeOtherSessions, lockCredential } from "./mfa";

export type SessionSummary = {
  /** SHA-256 of the cookie token: it identifies the session for revocation and cannot be turned back into the cookie. */
  id: string;
  current: boolean;
  /** Password accepted, second factor still to do. */
  mfaPending: boolean;
  device: DeviceLabel;
  createdAt: Date;
  lastSeenAt: Date;
};

/** The sessions of the user that are still usable, the current one first and then the most recently active. */
export async function listSessions(userId: string, currentToken: string | undefined, now = new Date()): Promise<SessionSummary[]> {
  const currentId = currentToken ? sha256Hex(currentToken) : null;
  const [rows, credential] = await withUser({ userId }, async (tx) => [
    await tx.session.findMany({ where: { userId }, orderBy: { lastSeenAt: "desc" } }),
    await tx.userCredential.findUnique({ where: { userId }, select: { totpEnabledAt: true } }),
  ] as const);
  return rows
    .filter((row) => sessionIsValid(row, now))
    .map((row) => ({
      id: row.id,
      current: row.id === currentId,
      mfaPending: credential?.totpEnabledAt != null && row.mfaVerifiedAt === null,
      device: describeUserAgent(row.userAgent),
      createdAt: row.createdAt,
      lastSeenAt: row.lastSeenAt,
    }))
    .filter((session) => !session.mfaPending || session.current || now.getTime() < session.createdAt.getTime() + MFA_PENDING_MS)
    .sort((a, b) => Number(b.current) - Number(a.current));
}

/**
 * Signs another device out. The current session is never closed here (that is signing out), and a session
 * of someone else is never touched: the row must belong to the user.
 */
export async function revokeSession(userId: string, sessionId: string, currentToken: string | undefined): Promise<"revoked" | "not_found" | "current"> {
  if (!/^[0-9a-f]{64}$/.test(sessionId)) return "not_found";
  if (currentToken && sessionId === sha256Hex(currentToken)) return "current";
  return withUser({ userId }, async (tx) => {
    const closed = await tx.session.deleteMany({ where: { id: sessionId, userId } });
    if (closed.count === 0) return "not_found" as const;
    await recordEvent(tx, { action: "auth.session_revoked", entityType: "app_user", entityId: userId, global: true });
    return "revoked" as const;
  });
}

/** Signs out every device but this one; returns how many sessions were closed. */
export async function revokeOtherSessions(userId: string, currentToken: string | undefined): Promise<number> {
  return withUser({ userId }, async (tx) => {
    const closed = await tx.session.deleteMany({ where: currentToken ? { userId, NOT: { id: sha256Hex(currentToken) } } : { userId } });
    if (closed.count > 0) await recordEvent(tx, { action: "auth.sessions_revoked", entityType: "app_user", entityId: userId, global: true, data: { count: closed.count } });
    return closed.count;
  });
}

export type PasswordChangeResult =
  | { status: "ok" }
  // Wrong current password, or an account that no longer exists.
  | { status: "invalid" }
  | { status: "rate_limited" }
  | { status: "weak_password"; problem: PasswordProblem }
  | { status: "same_password" };

/**
 * Changes the password of a signed-in user. The current password is asked like it is to turn 2FA off: a stolen
 * session cookie must not be enough to take the account over. Every other session is closed in the same
 * transaction, so whoever held the old password or a stolen cookie is signed out.
 */
export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  scope: { keepSessionToken?: string; now?: Date } = {},
): Promise<PasswordChangeResult> {
  const now = scope.now ?? new Date();
  if (!(await hit("password:user", userId, RATE_LIMITS.passwordUser)).allowed) return { status: "rate_limited" };
  return withUser({ userId }, async (tx) => {
    await lockCredential(tx, userId);
    const credential = await tx.userCredential.findUnique({ where: { userId } });
    const user = await tx.user.findUnique({ where: { id: userId }, select: { email: true, disabledAt: true } });
    if (!credential || !user || user.disabledAt) return { status: "invalid" } as const;
    // The current password comes first: someone without it learns nothing about the policy or the old password.
    if (!(await verifyPassword(credential.passwordHash, currentPassword))) {
      await recordEvent(tx, { action: "auth.password_change_failed", entityType: "app_user", entityId: userId, global: true });
      return { status: "invalid" } as const;
    }
    const problem = checkPassword(newPassword, user.email);
    if (problem) return { status: "weak_password", problem } as const;
    if (newPassword === currentPassword) return { status: "same_password" } as const;

    await tx.userCredential.update({ where: { userId }, data: { passwordHash: await hashPassword(newPassword), passwordChangedAt: now } });
    await closeOtherSessions(tx, userId, scope.keepSessionToken);
    await recordEvent(tx, { action: "auth.password_changed", entityType: "app_user", entityId: userId, global: true });
    return { status: "ok" } as const;
  });
}
