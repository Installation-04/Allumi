import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { formatMoney, MAX_LINE_CENTS, parseMoney, roundDiv } from "@/modules/ledger";

const amount = fc.bigInt({ min: -MAX_LINE_CENTS, max: MAX_LINE_CENTS });

describe("rounding (half away from zero)", () => {
  it("matches the reference table", () => {
    // value in thousandths of a cent / 10: 0.005 -> 0.01, -0.005 -> -0.01, 0.0049 -> 0.00
    expect(roundDiv(5n, 10n)).toBe(1n);
    expect(roundDiv(-5n, 10n)).toBe(-1n);
    expect(roundDiv(49n, 10_000n)).toBe(0n);
    expect(roundDiv(15n, 10n)).toBe(2n);
    expect(roundDiv(25n, 10n)).toBe(3n); // not banker's rounding
    expect(roundDiv(-25n, 10n)).toBe(-3n);
    expect(roundDiv(0n, 7n)).toBe(0n);
    expect(roundDiv(1n, 3n)).toBe(0n);
    expect(roundDiv(2n, 3n)).toBe(1n);
  });

  it("refuses a denominator that is not positive", () => {
    expect(() => roundDiv(1n, 0n)).toThrow(RangeError);
    expect(() => roundDiv(1n, -2n)).toThrow(RangeError);
  });

  it("P5 property: symmetric, within half a unit, and exact when the division is exact", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(10n ** 18n), max: 10n ** 18n }), fc.bigInt({ min: 1n, max: 10n ** 9n }), (n, d) => {
        const r = roundDiv(n, d);
        expect(roundDiv(-n, d)).toBe(-r); // round(-x) = -round(x)
        expect(2n * (r * d - n) <= d && 2n * (n - r * d) <= d).toBe(true); // |r - n/d| <= 1/2
        expect(roundDiv(n * d, d)).toBe(n); // exact when d divides
      }),
    );
  });

  it("property: monotonic in the numerator", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }), fc.bigInt({ min: 0n, max: 10n ** 6n }), fc.bigInt({ min: 1n, max: 10_000n }), (n, step, d) => {
        expect(roundDiv(n, d) <= roundDiv(n + step, d)).toBe(true);
      }),
    );
  });
});

describe("money text", () => {
  it("formats in fr-CA and en", () => {
    expect(formatMoney(123456n, "fr-CA")).toBe("1 234,56 $");
    expect(formatMoney(123456n, "en")).toBe("$1,234.56");
    expect(formatMoney(5n, "en")).toBe("$0.05");
    expect(formatMoney(0n, "fr-CA")).toBe("0,00 $");
    expect(formatMoney(-100n, "en")).toBe("-$1.00");
    expect(formatMoney(-123456789n, "fr-CA")).toBe("-1 234 567,89 $");
  });

  it("reads what people type", () => {
    expect(parseMoney("1 234,56 $", "fr-CA")).toBe(123456n);
    expect(parseMoney("1 234,56", "fr-CA")).toBe(123456n);
    expect(parseMoney("1234.56", "fr-CA")).toBe(123456n); // a lone dot is accepted in French
    expect(parseMoney("1234", "fr-CA")).toBe(123400n);
    expect(parseMoney(",5", "fr-CA")).toBe(50n);
    expect(parseMoney("-12,5", "fr-CA")).toBe(-1250n);
    expect(parseMoney("−12,50", "fr-CA")).toBe(-1250n); // typographic minus
    expect(parseMoney("$1,234.56", "en")).toBe(123456n);
    expect(parseMoney("1234.5", "en")).toBe(123450n);
    expect(parseMoney("0", "en")).toBe(0n);
  });

  it("refuses what is not an amount", () => {
    for (const bad of ["", " ", "-", "$", "abc", "1,5,5", "1.234,5", "1,234", "1.2.3", "12,345", "1e3", "NaN", "--1", "1 2 3,4x"]) {
      expect(parseMoney(bad, "fr-CA"), `fr ${bad}`).toBeNull();
    }
    for (const bad of ["1,23", "1,2345.00", "12.345", "1.2.3", ".", "1,,000.00", "10,00", "abc"]) {
      expect(parseMoney(bad, "en"), `en ${bad}`).toBeNull();
    }
    expect(parseMoney("1000000000000,01", "fr-CA")).toBeNull(); // above the ceiling
    expect(parseMoney("1000000000000,00", "fr-CA")).toBe(MAX_LINE_CENTS);
  });

  it("P7 property: parse(format(x)) = x in both languages", () => {
    fc.assert(
      fc.property(amount, (cents) => {
        expect(parseMoney(formatMoney(cents, "fr-CA"), "fr-CA")).toBe(cents);
        expect(parseMoney(formatMoney(cents, "en"), "en")).toBe(cents);
      }),
    );
  });

  it("property: never accepts more than two decimals", () => {
    fc.assert(
      fc.property(fc.nat(10_000_000), fc.integer({ min: 100, max: 99999 }), (whole, fraction) => {
        expect(parseMoney(`${whole},${fraction}`, "fr-CA")).toBeNull();
        expect(parseMoney(`${whole}.${fraction}`, "en")).toBeNull();
      }),
    );
  });
});
