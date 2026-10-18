import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  coversWithoutGap,
  computeTaxes,
  decimalFromDb,
  decimalToDb,
  documentTotals,
  formatDecimal,
  formatPercent,
  lineAmountCents,
  parseDecimal,
  parsePercent,
  planRateChange,
  QUANTITY_SCALE,
  QUEBEC_TAX_CODES,
  QUEBEC_TAXES,
  rateOn,
  recoverableCents,
  RATE_SCALE,
  UNIT_PRICE_SCALE,
  type RateRow,
  type TaxableLine,
} from "@/modules/taxes/client";

describe("decimals", () => {
  it("reads quantities and prices in both languages, with the right number of decimals", () => {
    expect(parseDecimal("2,5", QUANTITY_SCALE, "fr-CA")).toBe(25_000n);
    expect(parseDecimal("1 234,5678", QUANTITY_SCALE, "fr-CA")).toBe(12_345_678n);
    expect(parseDecimal("1,234.5678", QUANTITY_SCALE, "en")).toBe(12_345_678n);
    expect(parseDecimal("19.99", UNIT_PRICE_SCALE, "en")).toBe(19_990_000n);
    expect(parseDecimal("0,000001", UNIT_PRICE_SCALE, "fr-CA")).toBe(1n);
  });

  it("refuses too many decimals, several marks, letters, a sign where none is allowed", () => {
    expect(parseDecimal("1,23456", QUANTITY_SCALE, "fr-CA")).toBeNull();
    expect(parseDecimal("1,2,3", QUANTITY_SCALE, "fr-CA")).toBeNull();
    expect(parseDecimal("1.234,5", QUANTITY_SCALE, "fr-CA")).toBeNull();
    expect(parseDecimal("abc", QUANTITY_SCALE, "en")).toBeNull();
    expect(parseDecimal("-1", QUANTITY_SCALE, "en")).toBeNull();
    expect(parseDecimal("-1", UNIT_PRICE_SCALE, "en", true)).toBe(-1_000_000n);
    expect(parseDecimal("", QUANTITY_SCALE, "en")).toBeNull();
    expect(parseDecimal("12345678901234567890", QUANTITY_SCALE, "en")).toBeNull(); // more than 19 digits
  });

  it("writes what it reads (round trip), and speaks the database's language", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -1_000_000_000_000n, max: 1_000_000_000_000n }), fc.constantFrom("fr-CA" as const, "en" as const), (value, locale) => {
        expect(parseDecimal(formatDecimal(value, UNIT_PRICE_SCALE, locale), UNIT_PRICE_SCALE, locale, true)).toBe(value);
        expect(decimalFromDb(decimalToDb(value, UNIT_PRICE_SCALE), UNIT_PRICE_SCALE)).toBe(value);
      }),
    );
    expect(decimalToDb(25_000n, 4)).toBe("2.5");
    expect(decimalFromDb("19.990000", 6)).toBe(19_990_000n);
    expect(decimalFromDb("-0.5", 4)).toBe(-5_000n);
  });
});

describe("amount of a line", () => {
  it("is round(quantity × price) to the cent, half away from zero", () => {
    expect(lineAmountCents(10_000n, 19_990_000n)).toBe(1_999n); // 1 × 19.99
    expect(lineAmountCents(25_000n, 3_330_000n)).toBe(833n); // 2.5 × 3.33 = 8.325 -> 8.33
    expect(lineAmountCents(-25_000n, 3_330_000n)).toBe(-833n); // symmetric
    expect(lineAmountCents(30_000n, 1_666_667n)).toBe(500n); // 3 × 1.666667 = 5.000001
    expect(lineAmountCents(1n, 1n)).toBe(0n);
  });

  it("is symmetric, and within half a cent of the exact product (P5 for lines)", () => {
    const q = fc.bigInt({ min: 1n, max: 1_000_000_000n });
    const p = fc.bigInt({ min: 1n, max: 100_000_000_000n });
    fc.assert(
      fc.property(q, p, (quantity, price) => {
        const cents = lineAmountCents(quantity, price);
        expect(lineAmountCents(-quantity, price)).toBe(-cents);
        const exact2 = quantity * price; // exact value × 10^10; a cent is 10^8 of it
        expect(2n * (exact2 - cents * 10n ** 8n) <= 10n ** 8n).toBe(true);
        expect(2n * (cents * 10n ** 8n - exact2) <= 10n ** 8n).toBe(true);
      }),
    );
  });
});

describe("rates", () => {
  it("reads and writes a percentage with up to four decimals", () => {
    expect(parsePercent("9,975", "fr-CA")).toBe(99_750n);
    expect(parsePercent("9.975 %", "en")).toBe(99_750n);
    expect(parsePercent("5", "fr-CA")).toBe(50_000n);
    expect(parsePercent("0", "en")).toBe(0n);
    expect(parsePercent("99.9999", "en")).toBe(999_999n);
    expect(parsePercent("100", "en")).toBeNull();
    expect(parsePercent("9.97555", "en")).toBeNull();
    expect(parsePercent("-5", "en")).toBeNull();
    expect(formatPercent(99_750n, "fr-CA")).toBe("9,975 %");
    expect(formatPercent(99_750n, "en")).toBe("9.975%");
    expect(formatPercent(50_000n, "fr-CA")).toBe("5 %");
  });

  const history: RateRow[] = [
    { id: "a", rateMicro: 70_000n, from: "2008-01-01", to: "2010-12-31" },
    { id: "b", rateMicro: 50_000n, from: "2011-01-01", to: "2012-12-31" },
    { id: "c", rateMicro: 99_750n, from: "2013-01-01", to: null },
  ];

  it("finds the rate in force on a date, both ends of a range included (P14)", () => {
    expect(rateOn(history, "2007-12-31")).toBeNull();
    expect(rateOn(history, "2008-01-01")).toBe(70_000n);
    expect(rateOn(history, "2010-12-31")).toBe(70_000n);
    expect(rateOn(history, "2011-01-01")).toBe(50_000n);
    expect(rateOn(history, "2012-12-31")).toBe(50_000n);
    expect(rateOn(history, "2013-01-01")).toBe(99_750n);
    expect(rateOn(history, "2999-12-31")).toBe(99_750n);
  });

  it("gives one rate per date for any history built by extending it (P14)", () => {
    const dates = fc.integer({ min: 0, max: 5000 }).map((days) => new Date(Date.UTC(2000, 0, 1 + days)).toISOString().slice(0, 10));
    fc.assert(
      fc.property(fc.uniqueArray(dates, { minLength: 1, maxLength: 8 }), fc.array(fc.bigInt({ min: 0n, max: 999_999n }), { minLength: 8, maxLength: 8 }), (starts, rates) => {
        // extend the history one start at a time, in order, with planRateChange
        let rows: RateRow[] = [];
        [...starts].sort().forEach((from, index) => {
          const planned = planRateChange(rows, from);
          if (!planned.ok) return;
          rows = rows.map((row) => (planned.plan.closePrevious?.id === row.id ? { ...row, to: planned.plan.closePrevious.to } : row));
          rows.push({ id: String(index), rateMicro: rates[index] ?? 0n, from, to: null });
        });
        // no two ranges overlap, so no date has two rates
        for (const [i, a] of rows.entries()) {
          for (const b of rows.slice(i + 1)) {
            const aEnd = a.to ?? "9999-12-31";
            const bEnd = b.to ?? "9999-12-31";
            expect(a.from <= bEnd && b.from <= aEnd, `${a.from}..${aEnd} vs ${b.from}..${bEnd}`).toBe(false);
          }
        }
        expect(coversWithoutGap(rows)).toBe(true);
        for (const row of rows) expect(rateOn(rows, row.from)).toBe(row.rateMicro);
      }),
    );
  });

  it("only extends the history at its end", () => {
    expect(planRateChange([], "2013-01-01")).toEqual({ ok: true, plan: {} });
    expect(planRateChange(history, "2026-01-01")).toEqual({ ok: true, plan: { closePrevious: { id: "c", to: "2025-12-31" } } });
    expect(planRateChange(history, "2013-01-01")).toEqual({ ok: false, problem: "notAfterLast" });
    expect(planRateChange(history, "2012-06-01")).toEqual({ ok: false, problem: "notAfterLast" });
    const closed: RateRow[] = [{ id: "z", rateMicro: 1n, from: "2020-01-01", to: "2020-12-31" }];
    expect(planRateChange(closed, "2020-06-01")).toEqual({ ok: false, problem: "overlap" });
    expect(planRateChange(closed, "2021-03-01")).toEqual({ ok: true, plan: {} });
  });

  it("starts the Québec taxes at the published rates", () => {
    expect(QUEBEC_TAXES.map((tax) => [tax.code, tax.rateMicro, tax.from])).toEqual([
      ["TPS", 50_000n, "2008-01-01"],
      ["TVQ", 99_750n, "2013-01-01"],
    ]);
    // every code that names a tax names one of the starter taxes
    const known = new Set(QUEBEC_TAXES.map((tax) => tax.code));
    for (const code of QUEBEC_TAX_CODES) {
      for (const tax of code.taxCodes) expect(known.has(tax), `${code.code} -> ${tax}`).toBe(true);
      expect(code.treatment === "STANDARD").toBe(code.taxCodes.length > 0);
    }
  });
});

describe("taxes of a document", () => {
  const rates = new Map([
    ["gst", 50_000n],
    ["qst", 99_750n],
  ]);
  const both = ["gst", "qst"];

  it("computes GST and QST on 100.00 $ (the known case: 5.00 and 9.98)", () => {
    const lines: TaxableLine[] = [{ amountCents: 10_000n, taxIds: both }];
    for (const rounding of ["PER_LINE", "PER_DOCUMENT"] as const) {
      expect(computeTaxes(lines, rates, rounding)).toEqual([
        { taxId: "gst", rateMicro: 50_000n, baseCents: 10_000n, amountCents: 500n },
        { taxId: "qst", rateMicro: 99_750n, baseCents: 10_000n, amountCents: 998n }, // 9.975 -> 9.98
      ]);
    }
    expect(documentTotals(lines, computeTaxes(lines, rates, "PER_LINE"))).toEqual({ subtotalCents: 10_000n, taxTotalCents: 1_498n, totalCents: 11_498n });
  });

  it("rounds per line and per document differently on known cases", () => {
    // three lines of 0.10 $: per line 0.005 -> 0.01 three times; per document 0.30 × 5 % = 0.015 -> 0.02
    const lines: TaxableLine[] = [10n, 10n, 10n].map((amountCents) => ({ amountCents, taxIds: ["gst"] }));
    expect(computeTaxes(lines, rates, "PER_LINE")[0]?.amountCents).toBe(3n);
    expect(computeTaxes(lines, rates, "PER_DOCUMENT")[0]?.amountCents).toBe(2n);
  });

  it("taxes only the lines that carry a tax, and a line twice for one tax counts once", () => {
    const lines: TaxableLine[] = [
      { amountCents: 10_000n, taxIds: ["gst"] },
      { amountCents: 5_000n, taxIds: [] },
      { amountCents: 2_000n, taxIds: ["gst", "gst"] },
    ];
    expect(computeTaxes(lines, rates, "PER_LINE")).toEqual([{ taxId: "gst", rateMicro: 50_000n, baseCents: 12_000n, amountCents: 600n }]);
  });

  it("handles a discount line (negative amount) symmetrically", () => {
    const lines: TaxableLine[] = [
      { amountCents: 10_000n, taxIds: both },
      { amountCents: -2_500n, taxIds: both },
    ];
    expect(computeTaxes(lines, rates, "PER_DOCUMENT")).toEqual([
      { taxId: "gst", rateMicro: 50_000n, baseCents: 7_500n, amountCents: 375n },
      { taxId: "qst", rateMicro: 99_750n, baseCents: 7_500n, amountCents: 748n }, // 7.48125 -> 7.48
    ]);
  });

  it("refuses a tax without a rate (the screen says which date has none)", () => {
    expect(() => computeTaxes([{ amountCents: 100n, taxIds: ["unknown"] }], rates, "PER_LINE")).toThrow(RangeError);
  });

  const lineArb = fc.record({ amountCents: fc.bigInt({ min: -10_000_000n, max: 10_000_000n }), taxIds: fc.subarray(["gst", "qst"]) });

  it("differs between per-line and per-document rounding by at most (n + 1) / 2 cents (P6)", () => {
    fc.assert(
      fc.property(fc.array(lineArb, { minLength: 1, maxLength: 30 }), (lines) => {
        const perLine = computeTaxes(lines, rates, "PER_LINE");
        const perDocument = computeTaxes(lines, rates, "PER_DOCUMENT");
        expect(perLine.map((t) => t.taxId)).toEqual(perDocument.map((t) => t.taxId));
        perLine.forEach((tax, index) => {
          const other = perDocument[index];
          const n = BigInt(lines.filter((line) => line.taxIds.includes(tax.taxId)).length);
          const gap = tax.amountCents - (other?.amountCents ?? 0n);
          expect((gap < 0n ? -gap : gap) * 2n <= n + 1n, `gap ${gap} for ${n} lines`).toBe(true);
          expect(tax.baseCents).toBe(other?.baseCents);
        });
      }),
    );
  });

  it("is non-negative and non-decreasing in the base for positive amounts (P6)", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 1_000_000_000n }), fc.bigInt({ min: 0n, max: 1_000n }), (base, extra) => {
        const at = (amount: bigint) => computeTaxes([{ amountCents: amount, taxIds: ["qst"] }], rates, "PER_DOCUMENT")[0]?.amountCents ?? 0n;
        expect(at(base) >= 0n).toBe(true);
        expect(at(base + extra) >= at(base)).toBe(true);
      }),
    );
  });

  it("splits the claimable share of a purchase tax", () => {
    expect(recoverableCents(998n)).toBe(998n);
    expect(recoverableCents(998n, 5_000n)).toBe(499n);
    expect(recoverableCents(999n, 5_000n)).toBe(500n); // 499.5 -> 500
    expect(() => recoverableCents(1n, 10_001n)).toThrow(RangeError);
    expect(RATE_SCALE).toBe(1_000_000n);
  });
});
