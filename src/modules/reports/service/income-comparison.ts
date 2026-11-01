import "server-only";
import { requireRole } from "@/modules/companies";
import { isValidIsoDate } from "@/modules/ledger";
import { AppError } from "@/platform/errors";
import { withCompany,type CompanyContext } from "@/platform/tenant";
import { buildIncomeStatement,type AccountTotals } from "../domain/statements";
import { buildIncomeComparison,type IncomeComparison } from "../domain/income-comparison";
type Row=Omit<AccountTotals,"debitCents"|"creditCents">&{current_debit:bigint;current_credit:bigint;reference_debit:bigint;reference_credit:bigint};
/** Both periods and their account metadata share one database statement snapshot. */
export async function getIncomeComparison(actor:CompanyContext,periods:Pick<IncomeComparison,"current"|"reference">):Promise<IncomeComparison>{
 for(const p of [periods.current,periods.reference])if(!isValidIsoDate(p.from)||!isValidIsoDate(p.to)||p.from>p.to)throw new AppError("reports.period");
 return withCompany(actor,async tx=>{
  await requireRole(tx,"ledger.read");
  const rows=await tx.$queryRaw<Row[]>`
   SELECT a.id AS "accountId",a.code,a.name_fr AS "nameFr",a.name_en AS "nameEn",a.type,a.subtype,
    coalesce(sum(l.debit_cents) FILTER(WHERE l.entry_date BETWEEN ${periods.current.from}::date AND ${periods.current.to}::date),0)::bigint AS current_debit,
    coalesce(sum(l.credit_cents) FILTER(WHERE l.entry_date BETWEEN ${periods.current.from}::date AND ${periods.current.to}::date),0)::bigint AS current_credit,
    coalesce(sum(l.debit_cents) FILTER(WHERE l.entry_date BETWEEN ${periods.reference.from}::date AND ${periods.reference.to}::date),0)::bigint AS reference_debit,
    coalesce(sum(l.credit_cents) FILTER(WHERE l.entry_date BETWEEN ${periods.reference.from}::date AND ${periods.reference.to}::date),0)::bigint AS reference_credit
   FROM account a JOIN journal_line l ON l.company_id=a.company_id AND l.account_id=a.id
   WHERE a.company_id=${actor.companyId}::uuid AND a.type IN ('REVENUE','EXPENSE')
     AND (l.entry_date BETWEEN ${periods.current.from}::date AND ${periods.current.to}::date OR l.entry_date BETWEEN ${periods.reference.from}::date AND ${periods.reference.to}::date)
   GROUP BY a.id,a.code,a.name_fr,a.name_en,a.type,a.subtype`;
  const current=buildIncomeStatement(rows.map(r=>({...r,debitCents:r.current_debit,creditCents:r.current_credit})));
  const reference=buildIncomeStatement(rows.map(r=>({...r,debitCents:r.reference_debit,creditCents:r.reference_credit})));
  return buildIncomeComparison(current,reference,periods);
 });
}
