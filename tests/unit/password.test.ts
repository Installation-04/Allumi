import { describe, expect, it } from "vitest";
import { checkPassword, normalizeEmail, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/modules/auth/domain/password";
import { loginSchema, setupSchema } from "@/modules/auth/domain/schemas";

describe("password policy", () => {
  it("requires length, not composition", () => {
    expect(checkPassword("a".repeat(PASSWORD_MIN_LENGTH - 1))).toBe("tooShort");
    expect(checkPassword("a".repeat(PASSWORD_MIN_LENGTH))).toBeNull();
    expect(checkPassword("a".repeat(PASSWORD_MAX_LENGTH + 1))).toBe("tooLong");
  });

  it("counts characters, not UTF-16 units", () => {
    expect(checkPassword("é".repeat(PASSWORD_MIN_LENGTH))).toBeNull();
    expect(checkPassword("😀".repeat(PASSWORD_MIN_LENGTH))).toBeNull();
  });

  it("refuses the e-mail address as password", () => {
    expect(checkPassword("alex.exemple@exemple.test", "Alex.Exemple@exemple.TEST")).toBe("sameAsEmail");
  });

  it("normalizes e-mail addresses", () => {
    expect(normalizeEmail("  Alex@Exemple.TEST ")).toBe("alex@exemple.test");
  });
});

describe("form schemas", () => {
  it("normalizes the sign-in e-mail", () => {
    const parsed = loginSchema.parse({ email: "  Alex@Exemple.test ", password: "x" });
    expect(parsed.email).toBe("alex@exemple.test");
  });

  it("checks the password confirmation and the fiscal year month", () => {
    const base = { companyName: "A", displayName: "B", email: "a@exemple.test", password: "p", passwordConfirm: "p", locale: "fr-CA", fiscalYearStartMonth: "4" };
    expect(setupSchema.parse(base).fiscalYearStartMonth).toBe(4);
    expect(setupSchema.safeParse({ ...base, passwordConfirm: "q" }).success).toBe(false);
    expect(setupSchema.safeParse({ ...base, fiscalYearStartMonth: "13" }).success).toBe(false);
    expect(setupSchema.safeParse({ ...base, locale: "de" }).success).toBe(false);
  });
});
