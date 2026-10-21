import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  businessNumberSchema,
  cleanRegistrationNumber,
  formatGstNumber,
  formatQstNumber,
  gstNumberSchema,
  neqSchema,
  normalizePostalCode,
  qstNumberSchema,
} from "@/modules/companies/domain/registration";

describe("registration numbers", () => {
  it("accepts what people type and stores it without spaces", () => {
    expect(gstNumberSchema.parse("123 456 789 rt 0001")).toBe("123456789RT0001");
    expect(gstNumberSchema.parse("123456789-RT-0001")).toBe("123456789RT0001");
    expect(qstNumberSchema.parse("1234567890 TQ 0001")).toBe("1234567890TQ0001");
    expect(neqSchema.parse(" 1234567890 ")).toBe("1234567890");
    expect(businessNumberSchema.parse("123 456 789")).toBe("123456789");
  });

  it("treats an empty value as none, and refuses a malformed one", () => {
    for (const schema of [gstNumberSchema, qstNumberSchema, neqSchema, businessNumberSchema]) {
      expect(schema.parse("")).toBeNull();
      expect(schema.parse(null)).toBeNull();
      expect(schema.parse(undefined)).toBeNull();
    }
    expect(gstNumberSchema.safeParse("123456789RT001").success).toBe(false);
    expect(gstNumberSchema.safeParse("123456789TQ0001").success).toBe(false);
    expect(qstNumberSchema.safeParse("123456789RT0001").success).toBe(false);
    expect(neqSchema.safeParse("123456789").success).toBe(false);
    expect(businessNumberSchema.safeParse("12345678A").success).toBe(false);
  });

  it("prints a number with spaces and reads it back to the stored form (round trip)", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[0-9]{9}$/), fc.stringMatching(/^[0-9]{4}$/), (nine, four) => {
        const stored = `${nine}RT${four}`;
        expect(cleanRegistrationNumber(formatGstNumber(stored))).toBe(stored);
        expect(gstNumberSchema.parse(formatGstNumber(stored))).toBe(stored);
      }),
    );
    fc.assert(
      fc.property(fc.stringMatching(/^[0-9]{10}$/), fc.stringMatching(/^[0-9]{4}$/), (ten, four) => {
        const stored = `${ten}TQ${four}`;
        expect(qstNumberSchema.parse(formatQstNumber(stored))).toBe(stored);
      }),
    );
  });
});

describe("postal codes", () => {
  it("normalizes a Canadian postal code", () => {
    expect(normalizePostalCode("h2x1y4")).toBe("H2X 1Y4");
    expect(normalizePostalCode("H2X-1Y4")).toBe("H2X 1Y4");
    expect(normalizePostalCode(" g1a 0a2 ")).toBe("G1A 0A2");
  });

  it("refuses what is not one (letters that are never used, wrong shape)", () => {
    for (const value of ["D2X 1Y4", "H2X 1U4", "W2X 1Y4", "H2X1Y", "12345", "H2X 1Y45", ""]) expect(normalizePostalCode(value), value).toBeNull();
  });
});
