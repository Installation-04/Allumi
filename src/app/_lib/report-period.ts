import type { FiscalYearDto } from "@/modules/ledger";
import { isValidIsoDate } from "@/modules/ledger";

const text = (value: string | string[] | undefined): string => (Array.isArray(value) ? value[0] : value) ?? "";

/**
 * The period an income statement shows: the days in the address when they are real days in order, else the current
 * fiscal year so far (or, outside every fiscal year, the latest one). Without any fiscal year, the calendar year so far.
 */
export function statementPeriod(query: Record<string, string | string[] | undefined>, years: readonly FiscalYearDto[], today: string): { from: string; to: string } {
  const from = text(query.du);
  const to = text(query.au);
  if (isValidIsoDate(from) && isValidIsoDate(to) && from <= to) return { from, to };
  const current = years.find((year) => year.start <= today && today <= year.end);
  if (current) return { from: current.start, to: today };
  const latest = years[0];
  return latest ? { from: latest.start, to: latest.end } : { from: `${today.slice(0, 4)}-01-01`, to: today };
}

/** The day a balance sheet is for: the day in the address when it is a real day, else today. */
export function balanceDay(query: Record<string, string | string[] | undefined>, today: string): string {
  const day = text(query.au);
  return isValidIsoDate(day) ? day : today;
}
