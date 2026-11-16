import "server-only";
import { requireRole } from "@/modules/companies";
import { isValidIsoDate } from "@/modules/ledger";
import { AppError } from "@/platform/errors";
import { withCompany, type CompanyContext } from "@/platform/tenant";
import { buildTaxComparison, type TaxComparisonPeriods, type TaxComparisonSide } from "../domain/tax-comparison";

type Summary = { side: string; id: string; code: string; nameFr: string; nameEn: string; collected: string; recoverable: string; adjustment: string; settlement: string };
type Stats = { side: string; control: string; anomalies: number; lines: number };

/** Both periods, their metadata and ledger controls share one SQL statement snapshot. */
export async function getTaxComparison(actor: CompanyContext, periods: TaxComparisonPeriods) {
  for (const p of [periods.current, periods.reference]) if (!isValidIsoDate(p.from) || !isValidIsoDate(p.to) || p.from > p.to) throw new AppError("reports.period");
  return withCompany(actor, async tx => {
    await requireRole(tx, "ledger.read"); await requireRole(tx, "taxes.read");
    const [result] = await tx.$queryRaw<{ summary: Summary[]; stats: Stats[] }[]>`
      WITH periods(side,from_date,to_date) AS (VALUES
        ('current',${periods.current.from}::date,${periods.current.to}::date),
        ('reference',${periods.reference.from}::date,${periods.reference.to}::date)
      ), period_lines AS MATERIALIZED (
        SELECT p.side,l.id,l.tax_id,l.tax_box,l.debit_cents,l.credit_cents,a.subtype
        FROM periods p JOIN journal_line l ON l.company_id=${actor.companyId}::uuid AND l.entry_date BETWEEN p.from_date AND p.to_date
        JOIN account a ON a.company_id=l.company_id AND a.id=l.account_id
        JOIN journal_entry e ON e.company_id=l.company_id AND e.id=l.entry_id
        WHERE a.subtype='SALES_TAX' OR l.tax_id IS NOT NULL
      ), taxes AS (
        SELECT t.id,t.code,t.name_fr,t.name_en FROM tax t WHERE t.company_id=${actor.companyId}::uuid
          AND (t.is_active OR EXISTS(SELECT 1 FROM period_lines l WHERE l.tax_id=t.id))
      ), summary AS (
        SELECT p.side,t.id,t.code,t.name_fr AS "nameFr",t.name_en AS "nameEn",
          coalesce(sum(l.credit_cents-l.debit_cents) FILTER(WHERE l.tax_box='COLLECTED'),0)::text AS collected,
          coalesce(sum(l.debit_cents-l.credit_cents) FILTER(WHERE l.tax_box='RECOVERABLE'),0)::text AS recoverable,
          coalesce(sum(l.credit_cents-l.debit_cents) FILTER(WHERE l.tax_box='ADJUSTMENT'),0)::text AS adjustment,
          coalesce(sum(l.credit_cents-l.debit_cents) FILTER(WHERE l.tax_box='SETTLEMENT'),0)::text AS settlement
        FROM periods p CROSS JOIN taxes t LEFT JOIN period_lines l ON l.side=p.side AND l.tax_id=t.id
        GROUP BY p.side,t.id,t.code,t.name_fr,t.name_en
      ), stats AS (
        SELECT p.side,coalesce(sum(l.credit_cents-l.debit_cents) FILTER(WHERE l.subtype='SALES_TAX'),0)::text AS control,
          count(l.id) FILTER(WHERE l.tax_id IS NULL OR l.tax_box IS NULL OR l.subtype<>'SALES_TAX')::int AS anomalies,
          count(l.id) FILTER(WHERE l.tax_id IS NOT NULL AND l.tax_box IS NOT NULL)::int AS lines
        FROM periods p LEFT JOIN period_lines l ON l.side=p.side GROUP BY p.side
      ) SELECT (SELECT coalesce(jsonb_agg(s ORDER BY s.side,s.code,s.id),'[]') FROM summary s) AS summary,
        (SELECT jsonb_agg(s) FROM stats s) AS stats`;
    if (!result) throw new AppError("reports.period");
    const side = (key: string): TaxComparisonSide => {
      const stats = result.stats.find(row => row.side === key)!;
      const taxes = result.summary.filter(row => row.side === key).map(row => {
        const collectedCents = BigInt(row.collected), recoverableCents = BigInt(row.recoverable), adjustmentCents = BigInt(row.adjustment), settlementCents = BigInt(row.settlement);
        const netCents = collectedCents - recoverableCents + adjustmentCents;
        return { id: row.id, code: row.code, nameFr: row.nameFr, nameEn: row.nameEn, collectedCents, recoverableCents, adjustmentCents, settlementCents, netCents, movementCents: netCents + settlementCents };
      });
      const controlCents = BigInt(stats.control);
      return { taxes, controlCents, differenceCents: controlCents - taxes.reduce((sum,row) => sum + row.movementCents, 0n), anomalyCount: stats.anomalies, lineCount: stats.lines };
    };
    return buildTaxComparison(periods, side("current"), side("reference"));
  });
}
