import { isValidIsoDate, type Locale } from "@/modules/ledger/client";
import { resolveTaxReportPeriod, taxCalendarPeriod } from "./tax-period";
import { compareAmount, type ComparedAmount } from "./income-comparison";
import { taxSummaryTotals, type TaxSummaryRow } from "./tax-summary";
import { toCsv, csvFormatFor, type CsvCell } from "./csv";

export const TAX_COMPARISON_METRICS = ["collectedCents", "recoverableCents", "adjustmentCents", "netCents", "settlementCents", "movementCents"] as const;
export type TaxMetric = typeof TAX_COMPARISON_METRICS[number];
type Period = { from: string; to: string };
export type TaxComparisonPeriods = { current: Period; reference: Period };
export type TaxComparisonSide = { taxes: TaxSummaryRow[]; controlCents: bigint; differenceCents: bigint; anomalyCount: number; lineCount: number };
type Amounts = Record<TaxMetric, ComparedAmount>;
export type TaxComparison = { periods: TaxComparisonPeriods; current: TaxComparisonSide; reference: TaxComparisonSide; taxes: { id: string; code: string; nameFr: string; nameEn: string; amounts: Amounts }[]; totals: Amounts };

/** Calendar references keep their calendar frequency; custom references use an equal preceding day count. */
export function resolveTaxComparisonPeriods(query: Record<string, string | string[] | undefined>, years: readonly { start: string; end: string }[], today: string): TaxComparisonPeriods {
  if (Object.keys(query).some(key => !["du", "au", "frequence", "date", "du_ref", "au_ref"].includes(key))) throw new RangeError("Unknown comparison parameter");
  const selected = resolveTaxReportPeriod(query, years, today);
  const current = { from: selected.from, to: selected.to };
  const from = query.du_ref, to = query.au_ref;
  if (from !== undefined || to !== undefined) {
    if (typeof from !== "string" || typeof to !== "string" || !isValidIsoDate(from) || !isValidIsoDate(to) || from > to) throw new RangeError("Invalid reference period");
    return { current, reference: { from, to } };
  }
  const start = Date.parse(`${current.from}T00:00:00Z`), end = Date.parse(`${current.to}T00:00:00Z`), day = 86_400_000;
  const previous = new Date(start - day).toISOString().slice(0, 10);
  if (!isValidIsoDate(previous)) throw new RangeError("Reference outside supported dates");
  const reference = selected.frequency === "CUSTOM" ? { from: new Date(start - (end - start + day)).toISOString().slice(0, 10), to: previous } : taxCalendarPeriod(selected.frequency, previous);
  if (!isValidIsoDate(reference.from) || !isValidIsoDate(reference.to)) throw new RangeError("Reference outside supported dates");
  return { current, reference };
}

export function taxComparisonParams(periods: TaxComparisonPeriods): Record<string, string> {
  return { du: periods.current.from, au: periods.current.to, du_ref: periods.reference.from, au_ref: periods.reference.to };
}

export function buildTaxComparison(periods: TaxComparisonPeriods, current: TaxComparisonSide, reference: TaxComparisonSide): TaxComparison {
  const amounts = (a: ReturnType<typeof taxSummaryTotals>, b: ReturnType<typeof taxSummaryTotals>) => Object.fromEntries(TAX_COMPARISON_METRICS.map(key => [key, compareAmount(a[key], b[key])])) as Amounts;
  const zeros = taxSummaryTotals([]), currentById = new Map(current.taxes.map(row => [row.id, row])), referenceById = new Map(reference.taxes.map(row => [row.id, row]));
  const metadata = new Map([...reference.taxes, ...current.taxes].map(row => [row.id, row]));
  const taxes = [...metadata.values()].sort((a,b) => a.code.localeCompare(b.code) || a.id.localeCompare(b.id)).map(row => ({ id: row.id, code: row.code, nameFr: row.nameFr, nameEn: row.nameEn, amounts: amounts(currentById.get(row.id) ?? zeros, referenceById.get(row.id) ?? zeros) }));
  return { periods, current, reference, taxes, totals: amounts(taxSummaryTotals(current.taxes), taxSummaryTotals(reference.taxes)) };
}

export type TaxComparisonLabels = Record<TaxMetric, string> & { title: string; current: string; reference: string; difference: string; tax: string; metric: string; total: string; control: string; reconciliation: string; anomalies: string; lines: string; scope: string };

/** Aggregate fields only: no journal descriptions, account coordinates or technical identifiers. */
export function taxComparisonCsv(report: TaxComparison, labels: TaxComparisonLabels, locale: Locale) {
  const rows: CsvCell[][] = [[labels.title], [labels.scope], [labels.current, report.periods.current.from, report.periods.current.to], [labels.reference, report.periods.reference.from, report.periods.reference.to], [], [labels.tax, labels.metric, labels.current, labels.reference, labels.difference]];
  const add = (code: string, values: Amounts) => { for (const key of TAX_COMPARISON_METRICS) { const a = values[key]; rows.push([code, labels[key], a.currentCents, a.referenceCents, a.differenceCents]); } };
  for (const tax of report.taxes) add(tax.code, tax.amounts);
  add(labels.total, report.totals);
  rows.push([], [labels.metric, labels.current, labels.reference], [labels.control, report.current.controlCents, report.reference.controlCents], [labels.reconciliation, report.current.differenceCents, report.reference.differenceCents], [labels.anomalies, String(report.current.anomalyCount), String(report.reference.anomalyCount)], [labels.lines, String(report.current.lineCount), String(report.reference.lineCount)]);
  return toCsv(rows, csvFormatFor(locale));
}
