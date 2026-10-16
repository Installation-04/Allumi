import "server-only";
import { recordEvent } from "@/modules/audit";
import { withUser } from "@/platform/tenant";
import { generateRecoveryCodes, normalizeRecoveryCode } from "../domain/recovery-codes";
import { RATE_LIMITS } from "../domain/policy";
import { newTotpSecret, totpUri, verifyTotp } from "../domain/totp";
import { decrypt, encrypt, recoveryCodeHash, verifyPassword } from "./crypto";
import { hit } from "./rate-limit";
import { randomBytes } from "node:crypto";

export type MfaResult = "ok" | "invalid" | "rate_limited";

/**
 * Accepts a TOTP code (never twice: its time step must be newer than the last accepted one,
 * RFC 6238 §5.2) or a single-use recovery code.
 */
export async function verifySecondFactor(userId: string, code: string, now = new Date()): Promise<MfaResult> {
  if (!(await hit("mfa:user", userId, RATE_LIMITS.mfaUser)).allowed) return "rate_limited";

  const result = await withUser({ userId }, async (tx) => {
    const credential = await tx.userCredential.findUnique({ where: { userId } });
    if (!credential?.totpSecretEnc || !credential.totpEnabledAt) return "invalid" as const;

    const step = verifyTotp(decrypt(credential.totpSecretEnc), code, now.getTime());
    if (step !== null) {
      const claimed = await tx.userCredential.updateMany({
        where: { userId, OR: [{ totpLastStep: null }, { totpLastStep: { lt: BigInt(step) } }] },
        data: { totpLastStep: BigInt(step) },
      });
      return claimed.count === 1 ? ("ok" as const) : ("invalid" as const);
    }

    const recovery = normalizeRecoveryCode(code);
    if (recovery) {
      const used = await tx.userRecoveryCode.updateMany({
        where: { userId, codeHash: recoveryCodeHash(recovery), usedAt: null },
        data: { usedAt: now },
      });
      if (used.count === 1) {
        await recordEvent(tx, { action: "auth.recovery_code_used", entityType: "app_user", entityId: userId, global: true });
        return "ok" as const;
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
    const credential = await tx.userCredential.findUnique({ where: { userId } });
    if (!credential || credential.totpEnabledAt) return false;
    await tx.userCredential.update({ where: { userId }, data: { totpSecretEnc: encrypt(secret) } });
    return true;
  });
  return stored ? { secret, uri: totpUri(secret, email) } : null;
}

/** Confirms enrollment with a first valid code; returns the recovery codes, shown once. */
export async function confirmTotpEnrollment(userId: string, code: string, now = new Date()): Promise<string[] | null> {
  if (!(await hit("mfa:user", userId, RATE_LIMITS.mfaUser)).allowed) return null;
  const codes = generateRecoveryCodes((size) => randomBytes(size));
  const confirmed = await withUser({ userId }, async (tx) => {
    const credential = await tx.userCredential.findUnique({ where: { userId } });
    if (!credential?.totpSecretEnc || credential.totpEnabledAt) return false;
    const step = verifyTotp(decrypt(credential.totpSecretEnc), code, now.getTime());
    if (step === null) return false;
    await tx.userCredential.update({ where: { userId }, data: { totpEnabledAt: now, totpLastStep: BigInt(step) } });
    await tx.userRecoveryCode.deleteMany({ where: { userId } });
    await tx.userRecoveryCode.createMany({ data: codes.map((value) => ({ userId, codeHash: recoveryCodeHash(value) })) });
    await recordEvent(tx, { action: "auth.totp_enabled", entityType: "app_user", entityId: userId, global: true });
    return true;
  });
  return confirmed ? codes : null;
}

/** Turning 2FA off needs the password and a valid code. */
export async function disableTotp(userId: string, password: string, code: string, now = new Date()): Promise<MfaResult> {
  if (!(await hit("mfa:user", userId, RATE_LIMITS.mfaUser)).allowed) return "rate_limited";
  return withUser({ userId }, async (tx) => {
    const credential = await tx.userCredential.findUnique({ where: { userId } });
    if (!credential?.totpSecretEnc || !credential.totpEnabledAt) return "invalid";
    const step = verifyTotp(decrypt(credential.totpSecretEnc), code, now.getTime());
    const stepFresh = step !== null && (credential.totpLastStep === null || BigInt(step) > credential.totpLastStep);
    if (!stepFresh || !(await verifyPassword(credential.passwordHash, password))) return "invalid";
    await tx.userCredential.update({ where: { userId }, data: { totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null } });
    await tx.userRecoveryCode.deleteMany({ where: { userId } });
    // A session verified under the old factor must not skip the next one if 2FA is turned back on.
    await tx.session.updateMany({ where: { userId }, data: { mfaVerifiedAt: null } });
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
