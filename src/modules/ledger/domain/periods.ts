import { addMonthsFirstDay, formatIsoDate, lastDayOfMonth, parseIsoDate, type IsoDate } from "./dates";

export type FiscalYearBounds = { start: IsoDate; end: IsoDate };
export type PeriodPlan = { number: number; start: IsoDate; end: IsoDate };

/** The twelve months that start on the first day of `startMonth` (1-12) and contain `date`. */
export function fiscalYearContaining(date: IsoDate, startMonth: number): FiscalYearBounds {
  const parsed = parseIsoDate(date);
  if (!parsed) throw new RangeError(`invalid date: ${date}`);
  if (!Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12) throw new RangeError("the start month is 1 to 12");
  const startYear = parsed.month >= startMonth ? parsed.year : parsed.year - 1;
  const start = formatIsoDate(startYear, startMonth, 1);
  return { start, end: lastDayOfMonth(addMonthsFirstDay(start, 11)) };
}

/** The fiscal year that follows the one ending on `previousEnd`. */
export function fiscalYearAfter(previousEnd: IsoDate): FiscalYearBounds {
  const start = addMonthsFirstDay(previousEnd, 1);
  return { start, end: lastDayOfMonth(addMonthsFirstDay(start, 11)) };
}

/** Monthly periods covering a fiscal year exactly, numbered from 1. */
export function monthlyPeriods(year: FiscalYearBounds): PeriodPlan[] {
  const periods: PeriodPlan[] = [];
  let start = year.start;
  for (let number = 1; start <= year.end; number++) {
    const end = lastDayOfMonth(start);
    periods.push({ number, start, end: end > year.end ? year.end : end });
    start = addMonthsFirstDay(start, 1);
  }
  return periods;
}

export type PeriodRange = { id: string; start: IsoDate; end: IsoDate; status: "OPEN" | "LOCKED" };

/** The period that contains a date, if any. */
export function periodFor(periods: readonly PeriodRange[], date: IsoDate): PeriodRange | undefined {
  return periods.find((period) => date >= period.start && date <= period.end);
}

/** The rule the database enforces on every entry: its period exists and is open. */
export function acceptsEntries(periods: readonly PeriodRange[], date: IsoDate): "ok" | "noPeriod" | "locked" {
  const period = periodFor(periods, date);
  if (!period) return "noPeriod";
  return period.status === "OPEN" ? "ok" : "locked";
}
