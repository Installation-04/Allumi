import { daysInMonth, formatIsoDate, isValidIsoDate, parseIsoDate } from "@/modules/ledger/client";

export type TaxFrequency = "MONTH" | "QUARTER" | "YEAR";
export type TaxReportPeriod = { from: string; to: string; frequency: TaxFrequency | "CUSTOM"; referenceDate: string };
type Query = Record<string, string | string[] | undefined>;

/** Calendar shortcuts are explicit; custom dates also support non-calendar filing schedules. */
export function taxCalendarPeriod(frequency: TaxFrequency, referenceDate: string): { from: string; to: string } {
  const parsed = parseIsoDate(referenceDate);
  if (!parsed || !["MONTH", "QUARTER", "YEAR"].includes(frequency)) throw new RangeError("Invalid tax period");
  const { year, month } = parsed;
  const firstMonth = frequency === "YEAR" ? 1 : frequency === "QUARTER" ? Math.floor((month-1)/3)*3+1 : month;
  const lastMonth = firstMonth + (frequency === "YEAR" ? 11 : frequency === "QUARTER" ? 2 : 0);
  return { from: formatIsoDate(year,firstMonth,1), to: formatIsoDate(year,lastMonth,daysInMonth(year,lastMonth)) };
}

/** Never turn a malformed or conflicting filing period into a broader report. */
export function resolveTaxReportPeriod(query: Query, years: readonly { start: string; end: string }[], today: string): TaxReportPeriod {
  if (!isValidIsoDate(today)) throw new RangeError("Invalid current date");
  const scalar = (key: string): string | undefined => {
    const value = query[key];
    if (value !== undefined && typeof value !== "string") throw new RangeError("Repeated tax period parameter");
    return value;
  };
  const frequency = scalar("frequence"), referenceDate = scalar("date");
  if (frequency !== undefined || referenceDate !== undefined) {
    if (query.du !== undefined || query.au !== undefined || !["MONTH", "QUARTER", "YEAR"].includes(frequency ?? "") || !referenceDate) throw new RangeError("Conflicting tax period");
    return { ...taxCalendarPeriod(frequency as TaxFrequency,referenceDate), frequency: frequency as TaxFrequency, referenceDate };
  }
  const from = scalar("du"), to = scalar("au");
  if (from !== undefined || to !== undefined) {
    if (!from || !to || !isValidIsoDate(from) || !isValidIsoDate(to) || from > to) throw new RangeError("Invalid custom tax period");
    return { from, to, frequency: "CUSTOM", referenceDate: from };
  }
  const current = years.find(year => year.start <= today && today <= year.end);
  const fallback = current ? { from: current.start, to: today } : years[0] ? { from: years[0].start, to: years[0].end } : { from: `${today.slice(0,4)}-01-01`, to: today };
  return { ...fallback, frequency: "CUSTOM", referenceDate: today };
}

export function taxReportPeriodParams(period: TaxReportPeriod): Record<string,string> {
  return period.frequency === "CUSTOM" ? { du:period.from,au:period.to } : { frequence:period.frequency,date:period.referenceDate };
}
