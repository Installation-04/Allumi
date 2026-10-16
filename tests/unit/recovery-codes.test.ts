import { randomBytes } from "node:crypto";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { generateRecoveryCodes, normalizeRecoveryCode, RECOVERY_CODE_COUNT } from "@/modules/auth/domain/recovery-codes";

describe("recovery codes", () => {
  it("generates ten distinct codes in a readable format", () => {
    const codes = generateRecoveryCodes((size) => randomBytes(size));
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
    for (const code of codes) expect(code).toMatch(/^[2-9A-HJKMNP-Z]{5}-[2-9A-HJKMNP-Z]{5}$/);
  });

  it("never uses look-alike characters", () => {
    const joined = generateRecoveryCodes((size) => randomBytes(size)).join("");
    expect(joined).not.toMatch(/[01OIL]/);
  });

  it("accepts a code typed in any case, with or without the dash and spaces", () => {
    expect(normalizeRecoveryCode("abcde-fghjk")).toBe("ABCDE-FGHJK");
    expect(normalizeRecoveryCode(" abcde fghjk ")).toBe("ABCDE-FGHJK");
    expect(normalizeRecoveryCode("ABCDEFGHJK")).toBe("ABCDE-FGHJK");
    expect(normalizeRecoveryCode("123456")).toBe("");
    expect(normalizeRecoveryCode("")).toBe("");
  });

  it("property: normalizing a generated code is the identity", () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 4096, maxLength: 4096 }), (bytes) => {
        let offset = 0;
        const codes = generateRecoveryCodes((size) => {
          const slice = bytes.slice(offset, offset + size);
          offset += size;
          return slice.length === size ? slice : randomBytes(size);
        });
        for (const code of codes) expect(normalizeRecoveryCode(code)).toBe(code);
      }),
      { numRuns: 100 },
    );
  });
});
