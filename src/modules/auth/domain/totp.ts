import { Secret, TOTP } from "otpauth";

// RFC 6238 parameters understood by every authenticator app.
const PERIOD_SECONDS = 30;
const DIGITS = 6;
/** Accepted clock drift, in time steps, on each side. */
const WINDOW = 1;

export function newTotpSecret(): string {
  return new Secret({ size: 20 }).base32;
}

function totp(secretBase32: string, label: string, issuer: string): TOTP {
  return new TOTP({
    issuer,
    label,
    algorithm: "SHA1",
    digits: DIGITS,
    period: PERIOD_SECONDS,
    secret: Secret.fromBase32(secretBase32),
  });
}

export function totpUri(secretBase32: string, label: string, issuer = "Allumi"): string {
  return totp(secretBase32, label, issuer).toString();
}

/**
 * Returns the time step of a valid code, or null. The caller must refuse a step that is not
 * greater than the last accepted one (RFC 6238 §5.2: a code is never accepted twice).
 */
export function verifyTotp(secretBase32: string, code: string, nowMs: number): number | null {
  const cleaned = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(cleaned)) return null;
  const delta = totp(secretBase32, "", "Allumi").validate({ token: cleaned, timestamp: nowMs, window: WINDOW });
  if (delta === null) return null;
  return Math.floor(nowMs / 1000 / PERIOD_SECONDS) + delta;
}
