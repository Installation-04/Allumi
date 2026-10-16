import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Secret, TOTP } from "otpauth";
import { newTotpSecret, totpUri, verifyTotp } from "@/modules/auth/domain/totp";

const NOW = Date.UTC(2026, 9, 16, 12, 0, 0);
const code = (secret: string, timestamp: number) =>
  new TOTP({ secret: Secret.fromBase32(secret), digits: 6, period: 30 }).generate({ timestamp });
const step = (timestamp: number) => Math.floor(timestamp / 1000 / 30);

describe("TOTP", () => {
  it("accepts the current code and returns its time step", () => {
    const secret = newTotpSecret();
    expect(verifyTotp(secret, code(secret, NOW), NOW)).toBe(step(NOW));
  });

  it("tolerates one step of clock drift on each side, not two", () => {
    const secret = newTotpSecret();
    expect(verifyTotp(secret, code(secret, NOW - 30_000), NOW)).toBe(step(NOW) - 1);
    expect(verifyTotp(secret, code(secret, NOW + 30_000), NOW)).toBe(step(NOW) + 1);
    expect(verifyTotp(secret, code(secret, NOW - 90_000), NOW)).toBeNull();
  });

  it("ignores spaces and rejects anything that is not six digits", () => {
    const secret = newTotpSecret();
    const valid = code(secret, NOW);
    expect(verifyTotp(secret, `${valid.slice(0, 3)} ${valid.slice(3)}`, NOW)).toBe(step(NOW));
    for (const bad of ["", "12345", "1234567", "abcdef", "12 34 5a"]) expect(verifyTotp(secret, bad, NOW)).toBeNull();
  });

  it("builds an otpauth URI for authenticator apps", () => {
    const uri = totpUri(newTotpSecret(), "alex@exemple.test");
    expect(uri).toMatch(/^otpauth:\/\/totp\/Allumi:alex%40exemple\.test\?/);
    expect(uri).toContain("issuer=Allumi");
  });

  it("property: a code generated at t verifies within the window and its step is monotonic in t", () => {
    const secret = newTotpSecret();
    fc.assert(
      fc.property(fc.integer({ min: 1_700_000_000_000, max: 1_900_000_000_000 }), (t) => {
        const found = verifyTotp(secret, code(secret, t), t);
        expect(found).toBe(step(t));
      }),
      { numRuns: 200 },
    );
  });
});
