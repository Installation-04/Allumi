import "server-only";
import { recordEvent } from "@/modules/audit";
import { withAnonymous, withUser } from "@/platform/tenant";
import { normalizeEmail } from "../domain/password";
import { lockedUntil, RATE_LIMITS } from "../domain/policy";
import { dummyPasswordHash, verifyPassword } from "./crypto";
import { hit } from "./rate-limit";
import { createSession } from "./session";

export type LoginResult =
  | { status: "ok"; token: string; expiresAt: Date; userId: string; mfaRequired: boolean }
  // Unknown account, wrong password and locked account look the same from the outside.
  | { status: "invalid" }
  // Only the per-address and per-IP limiters answer this: they count unknown addresses too.
  | { status: "rate_limited" };

type LoginRow = { user_id: string; password_hash: string; totp_enabled: boolean; locked_until: Date | null; disabled: boolean };

export async function attemptLogin(input: { email: string; password: string; ip: string; userAgent: string | null }, now = new Date()): Promise<LoginResult> {
  const email = normalizeEmail(input.email);

  const [byIp, byEmail] = [await hit("login:ip", input.ip, RATE_LIMITS.loginIp), await hit("login:email", email, RATE_LIMITS.loginEmail)];
  if (!byIp.allowed || !byEmail.allowed) return { status: "rate_limited" };

  const rows = await withAnonymous((tx) => tx.$queryRaw<LoginRow[]>`SELECT * FROM auth_login_lookup(${email})`);
  const user = rows[0];

  // Always spend the hashing time, even when the account does not exist.
  const passwordOk = await verifyPassword(user?.password_hash ?? (await dummyPasswordHash()), input.password);
  const locked = user?.locked_until != null && user.locked_until.getTime() > now.getTime();

  if (!user || user.disabled || locked || !passwordOk) {
    if (user && !user.disabled && !locked) {
      await withUser({ userId: user.user_id }, async (tx) => {
        // A lock that has run out starts a new series of failures: otherwise the counter stays at the
        // threshold and a single wrong password every 15 minutes would keep the account locked for good.
        const credential = await tx.userCredential.update({
          where: { userId: user.user_id },
          data: user.locked_until != null ? { failedLoginCount: 1, lockedUntil: null } : { failedLoginCount: { increment: 1 } },
        });
        const until = lockedUntil(credential.failedLoginCount, now);
        if (until) await tx.userCredential.update({ where: { userId: user.user_id }, data: { lockedUntil: until } });
      });
    }
    await withAnonymous((tx) =>
      recordEvent(tx, {
        action: "auth.login_failed",
        entityType: "app_user",
        entityId: user?.user_id,
        global: true,
        subjectUserId: user?.user_id,
        data: { reason: !user ? "unknown" : locked ? "locked" : "password" },
      }),
    );
    return { status: "invalid" };
  }

  const session = await createSession(user.user_id, input.userAgent, now);
  await withUser({ userId: user.user_id }, async (tx) => {
    await tx.userCredential.update({ where: { userId: user.user_id }, data: { failedLoginCount: 0, lockedUntil: null } });
    await tx.user.update({ where: { id: user.user_id }, data: { lastLoginAt: now } });
    await tx.session.deleteMany({ where: { userId: user.user_id, expiresAt: { lt: now } } });
    await recordEvent(tx, { action: "auth.login", entityType: "app_user", entityId: user.user_id, global: true, data: { mfaRequired: user.totp_enabled } });
  });
  return { status: "ok", token: session.token, expiresAt: session.expiresAt, userId: user.user_id, mfaRequired: user.totp_enabled };
}
