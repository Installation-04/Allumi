import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  acceptsEntries,
  addMonthsFirstDay,
  daysInMonth,
  fiscalYearAfter,
  fiscalYearContaining,
  formatIsoDate,
  isValidIsoDate,
  lastDayOfMonth,
  monthlyPeriods,
  nextDay,
  parseIsoDate,
  periodFor,
  type PeriodRange,
} from "@/modules/ledger";

const isoDate = fc
  .record({ year: fc.integer({ min: 1990, max: 2090 }), month: fc.integer({ min: 1, max: 12 }), day: fc.integer({ min: 1, max: 28 }) })
  .map(({ year, month, day }) => formatIsoDate(year, month, day));

describe("calendar dates", () => {
  it("knows month lengths and leap years", () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(1900, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  it("validates ISO dates strictly", () => {
    for (const ok of ["2026-02-28", "2024-02-29", "2026-12-31"]) expect(isValidIsoDate(ok), ok).toBe(true);
    for (const bad of ["2026-02-29", "2026-13-01", "2026-00-10", "2026-04-31", "26-01-01", "2026-1-1", "2026/01/01", "", "2026-01-01T00:00", "0000-01-01"]) {
      expect(isValidIsoDate(bad), bad).toBe(false);
    }
    expect(parseIsoDate("2026-03-09")).toEqual({ year: 2026, month: 3, day: 9 });
  });

  it("moves between months and days without a time zone", () => {
    expect(addMonthsFirstDay("2026-01-31", 1)).toBe("2026-02-01");
    expect(addMonthsFirstDay("2026-11-15", 3)).toBe("2027-02-01");
    expect(addMonthsFirstDay("2026-03-15", -3)).toBe("2025-12-01");
    expect(lastDayOfMonth("2024-02-10")).toBe("2024-02-29");
    expect(nextDay("2026-02-28")).toBe("2026-03-01");
    expect(nextDay("2026-12-31")).toBe("2027-01-01");
    expect(nextDay("2026-06-10")).toBe("2026-06-11");
  });
});

describe("fiscal years and periods", () => {
  it("finds the fiscal year of a date, whatever the start month", () => {
    expect(fiscalYearContaining("2026-05-10", 1)).toEqual({ start: "2026-01-01", end: "2026-12-31" });
    expect(fiscalYearContaining("2026-05-10", 4)).toEqual({ start: "2026-04-01", end: "2027-03-31" });
    expect(fiscalYearContaining("2026-02-10", 4)).toEqual({ start: "2025-04-01", end: "2026-03-31" });
    expect(fiscalYearContaining("2026-04-01", 4).start).toBe("2026-04-01");
    expect(fiscalYearContaining("2026-03-31", 4).start).toBe("2025-04-01");
    expect(fiscalYearAfter("2026-12-31")).toEqual({ start: "2027-01-01", end: "2027-12-31" });
    expect(fiscalYearAfter("2027-03-31")).toEqual({ start: "2027-04-01", end: "2028-03-31" });
    expect(() => fiscalYearContaining("2026-05-10", 13)).toThrow(RangeError);
    expect(() => fiscalYearContaining("nope", 1)).toThrow(RangeError);
  });

  it("property: the fiscal year contains the date, lasts a year, and the next one starts the day after", () => {
    fc.assert(
      fc.property(isoDate, fc.integer({ min: 1, max: 12 }), (date, startMonth) => {
        const year = fiscalYearContaining(date, startMonth);
        expect(year.start <= date && date <= year.end).toBe(true);
        expect(parseIsoDate(year.start)?.month).toBe(startMonth);
        expect(parseIsoDate(year.start)?.day).toBe(1);
        expect(nextDay(year.end)).toBe(fiscalYearAfter(year.end).start);
        // the same year is found from any of its days
        expect(fiscalYearContaining(year.start, startMonth)).toEqual(year);
        expect(fiscalYearContaining(year.end, startMonth)).toEqual(year);
      }),
    );
  });

  it("property: monthly periods are 12, numbered from 1, contiguous, and cover the year exactly", () => {
    fc.assert(
      fc.property(isoDate, fc.integer({ min: 1, max: 12 }), (date, startMonth) => {
        const year = fiscalYearContaining(date, startMonth);
        const periods = monthlyPeriods(year);
        expect(periods).toHaveLength(12);
        expect(periods.map((p) => p.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
        expect(periods[0]?.start).toBe(year.start);
        expect(periods[11]?.end).toBe(year.end);
        for (let i = 1; i < periods.length; i++) expect(nextDay(periods[i - 1]?.end ?? "")).toBe(periods[i]?.start);
        // every day of the year is in exactly one period
        const probe = [year.start, date, year.end];
        for (const day of probe) expect(periods.filter((p) => day >= p.start && day <= p.end)).toHaveLength(1);
      }),
    );
  });

  it("P11 model: an entry is accepted exactly when its date falls in an open period", () => {
    const year = { start: "2026-01-01", end: "2026-12-31" };
    const base = monthlyPeriods(year).map((p): PeriodRange => ({ id: `p${p.number}`, start: p.start, end: p.end, status: "OPEN" }));
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.integer({ min: 0, max: 11 }), fc.boolean()), { maxLength: 30 }), isoDate, (operations, date) => {
        const periods = base.map((p) => ({ ...p }));
        for (const [index, lock] of operations) {
          const period = periods[index];
          if (period) period.status = lock ? "LOCKED" : "OPEN";
        }
        const expected = (() => {
          const inYear = date >= year.start && date <= year.end;
          if (!inYear) return "noPeriod";
          return periodFor(periods, date)?.status === "OPEN" ? "ok" : "locked";
        })();
        expect(acceptsEntries(periods, date)).toBe(expected);
      }),
    );
  });
});
