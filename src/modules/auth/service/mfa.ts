import "server-only";
import { recordEvent } from "@/modules/audit";
import { withUser, type Tx } from "@/platform/tenant";
import { generateRecoveryCodes, normalizeRecoveryCode } from "../domain/recovery-codes";
import { RATE_LIMITS, sessionIsValid, MFA_PENDING_MS } from "../domain/policy";
import { newTotpSecret, totpUri, verifyTotp } from "../domain/totp";
import { decrypt, encrypt, recoveryCodeHash, sha256Hex, verifyPassword } from "./crypto";
import { hit } from "./rate-limit";
import { randomBytes } from "node:crypto";

export type MfaResult = "ok" | "invalid" | "rate_limited";

export type EnrollmentResult = { status: "ok"; recoveryCodes: string[] } | { status: "invalid" } | { status: "rate_limited" };

type SessionScope = {
  /** The session the user is acting from: it stays open (and, on enrollment, is marked as verified). */
  keepSessionToken?: string;
  now?: Date;
};

/**
 * Closes every other session of the user after a change to the second factor, so that a stolen cookie
 * does not outlive the change. Without a token to keep, every session is closed.
 */
export async function closeOtherSessions(tx: Tx, userId: string, keepSessionToken: string | undefined): Promise<void> {
  await tx.session.deleteMany({ where: keepSessionToken ? { userId, NOT: { id: sha256Hex(keepSessionToken) } } : { userId } });
}

/**
 * Accepts a TOTP code (never twice: its time step must be newer than the last accepted one,
 * RFC 6238 §5.2) or a single-use recovery code.
 */
export async function verifySecondFactor(userId: string, code: string, now = new Date()): Promise<MfaResult> {
  return checkSecondFactor(userId, code, now);
}

/** Consume the code and authorize this live session in one transaction. */
export async function completeMfaSignIn(userId: string, token: string, code: string, now = new Date()): Promise<MfaResult> {
  if (!token || token.length < 20 || token.length > 128) return "invalid";
  return checkSecondFactor(userId, code, now, token);
}

export async function lockCredential(tx: Tx, userId: string): Promise<void> {
  await tx.$queryRaw`SELECT user_id FROM user_credential WHERE user_id=${userId}::uuid FOR UPDATE`;
}

async function checkSecondFactor(userId: string, code: string, now: Date, sessionToken?: string): Promise<MfaResult> {
  if (!(await hit("mfa:user", userId, RATE_LIMITS.mfaUser)).allowed) return "rate_limited";

  const result = await withUser({ userId }, async (tx) => {
    await lockCredential(tx, userId);
    const credential = await tx.userCredential.findUnique({ where: { userId } });
    if (!credential?.totpSecretEnc || !credential.totpEnabledAt) return "invalid" as const;
    if (sessionToken) {
      const id = sha256Hex(sessionToken);
      await tx.$queryRaw`SELECT id FROM session WHERE id=${id} AND user_id=${userId}::uuid FOR UPDATE`;
      const session = await tx.session.findFirst({ where: { id, userId }, include: { user: { select: { disabledAt: true } } } });
      if (!session || session.user.disabledAt || !sessionIsValid(session, now) || (!session.mfaVerifiedAt && now.getTime() >= session.createdAt.getTime() + MFA_PENDING_MS)) return "invalid" as const;
    }
    const accept = async (): Promise<MfaResult> => {
      if (sessionToken) await tx.session.update({ where: { id: sha256Hex(sessionToken), userId }, data: { mfaVerifiedAt: now } });
      return "ok";
    };

    const step = verifyTotp(decrypt(credential.totpSecretEnc), code, now.getTime());
    if (step !== null) {
      const claimed = await tx.userCredential.updateMany({
        where: { userId, OR: [{ totpLastStep: null }, { totpLastStep: { lt: BigInt(step) } }] },
        data: { totpLastStep: BigInt(step) },
      });
      return claimed.count === 1 ? accept() : ("invalid" as const);
    }

    const recovery = normalizeRecoveryCode(code);
    if (recovery) {
      const used = await tx.userRecoveryCode.updateMany({
        where: { userId, codeHash: recoveryCodeHash(recovery), usedAt: null },
        data: { usedAt: now },
      });
      if (used.count === 1) {
        await recordEvent(tx, { action: "auth.recovery_code_used", entityType: "app_user", entityId: userId, global: true });
        return accept();
      }
    }
    return "invalid" as const;
  });

  if (result === "invalid") {
    await withUser({ userId }, (tx) => recordEvent(tx, { action: "auth.mfa_failed", entityType: "app_user", entityId: userId, global: true }));
  }
  return result;
}

export async function totpStatus(userId: string): Promise<{ enabled: boolean; pending: boolean; recoveryCodesLeft: number }> {
  return withUser({ userId }, async (tx) => {
    const credential = await tx.userCredential.findUnique({ where: { userId } });
    const left = await tx.userRecoveryCode.count({ where: { userId, usedAt: null } });
    return { enabled: credential?.totpEnabledAt != null, pending: credential?.totpSecretEnc != null && credential.totpEnabledAt == null, recoveryCodesLeft: left };
  });
}

/** Generates a pending secret (replaces a previous pending one). Not active until confirmed. */
export async function beginTotpEnrollment(userId: string, email: string): Promise<{ secret: string; uri: string } | null> {
  const secret = newTotpSecret();
  const stored = await withUser({ userId }, async (tx) => {
    await lockCredential(tx, userId);
    const credential = await tx.userCredential.findUnique({ where: { userId } });
    if (!credential || credential.totpEnabledAt) return false;
    await tx.userCredential.update({ where: { userId }, data: { totpSecretEnc: encrypt(secret) } });
    return true;
  });
  return stored ? { secret, uri: totpUri(secret, email) } : null;
}

/**
 * Confirms enrollment with the account password and a first valid code; returns the recovery codes, shown once.
 * The password is asked like the one that turns 2FA off: a stolen session cookie must not be enough to enroll an
 * authenticator of the thief's own (the pending secret can be read back from the security page). The session it is
 * made from proves the second factor right away; the user's other sessions are closed.
 */
export async function confirmTotpEnrollment(userId: string, code: string, password: string, scope: SessionScope = {}): Promise<EnrollmentResult> {
  const now = scope.now ?? new Date();
  if (!(await hit("mfa:user", userId, RATE_LIMITS.mfaUser)).allowed) return { status: "rate_limited" };
  const codes = generateRecoveryCodes((size) => randomBytes(size));
  const confirmed = await withUser({ userId }, async (tx) => {
    await lockCredential(tx, userId);
    const credential = await tx.userCredential.findUnique({ where: { userId } });
    if (!credential?.totpSecretEnc || credential.totpEnabledAt) return false;
    if (!(await verifyPassword(credential.passwordHash, password))) return false;
    const step = verifyTotp(decrypt(credential.totpSecretEnc), code, now.getTime());
    if (step === null) return false;
    await tx.userCredential.update({ where: { userId }, data: { totpEnabledAt: now, totpLastStep: BigInt(step) } });
    await tx.userRecoveryCode.deleteMany({ where: { userId } });
    await tx.userRecoveryCode.createMany({ data: codes.map((value) => ({ userId, codeHash: recoveryCodeHash(value) })) });
    await closeOtherSessions(tx, userId, scope.keepSessionToken);
    if (scope.keepSessionToken) {
      await tx.session.updateMany({ where: { id: sha256Hex(scope.keepSessionToken), userId }, data: { mfaVerifiedAt: now } });
    }
    await recordEvent(tx, { action: "auth.totp_enabled", entityType: "app_user", entityId: userId, global: true });
    return true;
  });
  return confirmed ? { status: "ok", recoveryCodes: codes } : { status: "invalid" };
}

/** Turning 2FA off needs the password and a valid code. The user's other sessions are closed. */
export async function disableTotp(userId: string, password: string, code: string, scope: SessionScope = {}): Promise<MfaResult> {
  const now = scope.now ?? new Date();
  if (!(await hit("mfa:user", userId, RATE_LIMITS.mfaUser)).allowed) return "rate_limited";
  return withUser({ userId }, async (tx) => {
    await lockCredential(tx, userId);
    const credential = await tx.userCredential.findUnique({ where: { userId } });
    if (!credential?.totpSecretEnc || !credential.totpEnabledAt) return "invalid";
    const step = verifyTotp(decrypt(credential.totpSecretEnc), code, now.getTime());
    const stepFresh = step !== null && (credential.totpLastStep === null || BigInt(step) > credential.totpLastStep);
    if (!stepFresh || !(await verifyPassword(credential.passwordHash, password))) return "invalid";
    await tx.userCredential.update({ where: { userId }, data: { totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null } });
    await tx.userRecoveryCode.deleteMany({ where: { userId } });
    // The sessions that stay open must not carry the proof of the old factor into a later one.
    await tx.session.updateMany({ where: { userId }, data: { mfaVerifiedAt: null } });
    await closeOtherSessions(tx, userId, scope.keepSessionToken);
    await recordEvent(tx, { action: "auth.totp_disabled", entityType: "app_user", entityId: userId, global: true });
    return "ok";
  });
}

/** The pending (not yet confirmed) secret, to show its QR code again after a page reload. */
export async function pendingTotpEnrollment(userId: string, email: string): Promise<{ secret: string; uri: string } | null> {
  return withUser({ userId }, async (tx) => {
    const credential = await tx.userCredential.findUnique({ where: { userId } });
    if (!credential?.totpSecretEnc || credential.totpEnabledAt) return null;
    const secret = decrypt(credential.totpSecretEnc);
    return { secret, uri: totpUri(secret, email) };
  });
}
