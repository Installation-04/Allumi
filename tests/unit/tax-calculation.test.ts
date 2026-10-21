import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { calculateTaxes, decimalUnits, effectiveRate, percentageRate, ratePercentage } from "@/modules/taxes/client";
const taxes = [{ id: "GST", rate: "0.05" }, { id: "QST", rate: "0.09975" }];
describe("exact tax calculations", () => {
  it("computes independent taxes without compounding", () => {
    expect(calculateTaxes([{ quantity: "1", unitPrice: "100", taxes }], "PER_LINE")).toMatchObject({ subtotalCents: 10000n, taxCents: 1498n, totalCents: 11498n, taxes: [{ amountCents: 500n }, { amountCents: 998n }] });
    expect(percentageRate("9,975")).toBe("0.099750");
    expect(ratePercentage("0")).toBe("0");
    expect(ratePercentage("0.05")).toBe("5");
  });
  it("distinguishes line and document rounding", () => {
    const lines = Array.from({ length: 2 }, () => ({ quantity: "1", unitPrice: "0.05", taxes: [{ id: "GST", rate: "0.05" }] }));
    expect(calculateTaxes(lines, "PER_LINE").taxCents).toBe(0n);
    expect(calculateTaxes(lines, "PER_DOCUMENT").taxCents).toBe(1n);
  });
  it("preserves six-place inputs and rounds negative halves away from zero", () => {
    expect(calculateTaxes([{ quantity: "0.5", unitPrice: "0.01", taxes: [] }], "PER_LINE").totalCents).toBe(1n);
    expect(calculateTaxes([{ quantity: "-0.5", unitPrice: "0.01", taxes: [] }], "PER_LINE").totalCents).toBe(-1n);
    expect(decimalUnits("123456789012.123456")).toBe(123456789012123456n);
  });
  it("refuses gaps, overlaps, impossible dates and malformed rates", () => {
    const rates = [{ rate: "0.05", from: "2026-01-01", to: "2026-06-30" }, { rate: "0.06", from: "2026-07-01", to: null }];
    expect(effectiveRate(rates, "2026-06-30")).toBe("0.05");
    expect(effectiveRate(rates, "2026-07-01")).toBe("0.06");
    for (const date of ["2025-01-01", "2026-02-30"]) expect(() => effectiveRate(rates, date)).toThrow();
    expect(() => effectiveRate([...rates, rates[0]!], "2026-01-01")).toThrow();
    for (const value of ["100", "-5", "9.97501", "NaN", "1e2"]) expect(() => percentageRate(value)).toThrow();
    expect(() => calculateTaxes([{ quantity: "1", unitPrice: "1", taxes: [taxes[0]!, taxes[0]!] }], "PER_LINE")).toThrow();
  });
  it("conserves totals and reverses symmetrically for credits", () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 1000000 }), (cents) => {
      const price = `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
      for (const mode of ["PER_LINE", "PER_DOCUMENT"] as const) {
        const positive = calculateTaxes([{ quantity: "1", unitPrice: price, taxes }], mode);
        const negative = calculateTaxes([{ quantity: "-1", unitPrice: price, taxes }], mode);
        expect(positive.totalCents).toBe(positive.subtotalCents + positive.taxCents);
        expect(negative.totalCents).toBe(-positive.totalCents);
      }
    }));
  });
});
