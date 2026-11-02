import "server-only";
import { requireRole } from "@/modules/companies";
import { isValidIsoDate } from "@/modules/ledger";
import { AppError } from "@/platform/errors";
import { withCompany,type CompanyContext } from "@/platform/tenant";
import { buildBalanceSheet,type AccountTotals } from "../domain/statements";
import { buildBalanceComparison,type BalanceComparison } from "../domain/balance-comparison";
type Row=Omit<AccountTotals,"debitCents"|"creditCents">&{current_debit:string;current_credit:string;reference_debit:string;reference_credit:string;current_prior:string;reference_prior:string};
/** Cumulative balances, fiscal boundaries and both earnings splits share one statement snapshot. */
export async function getBalanceComparison(actor:CompanyContext,input:{asOf:string;referenceAsOf:string}):Promise<BalanceComparison>{
 if(!isValidIsoDate(input.asOf)||!isValidIsoDate(input.referenceAsOf))throw new AppError("reports.period");
 return withCompany(actor,async tx=>{
  await requireRole(tx,"ledger.read");
  const [result]=await tx.$queryRaw<{rows:Row[];current_start:string|null;reference_start:string|null}[]>`
   WITH dates AS (
    SELECT (SELECT start_date FROM fiscal_year WHERE company_id=${actor.companyId}::uuid AND ${input.asOf}::date BETWEEN start_date AND end_date) AS current_start,
     (SELECT start_date FROM fiscal_year WHERE company_id=${actor.companyId}::uuid AND ${input.referenceAsOf}::date BETWEEN start_date AND end_date) AS reference_start
   ), totals AS (
    SELECT a.id AS "accountId",a.code,a.name_fr AS "nameFr",a.name_en AS "nameEn",a.type,a.subtype,
     coalesce(sum(l.debit_cents) FILTER(WHERE l.entry_date<=${input.asOf}::date),0)::text AS current_debit,
     coalesce(sum(l.credit_cents) FILTER(WHERE l.entry_date<=${input.asOf}::date),0)::text AS current_credit,
     coalesce(sum(l.debit_cents) FILTER(WHERE l.entry_date<=${input.referenceAsOf}::date),0)::text AS reference_debit,
     coalesce(sum(l.credit_cents) FILTER(WHERE l.entry_date<=${input.referenceAsOf}::date),0)::text AS reference_credit,
     coalesce(sum(l.credit_cents-l.debit_cents) FILTER(WHERE a.type IN ('REVENUE','EXPENSE') AND l.entry_date<d.current_start),0)::text AS current_prior,
     coalesce(sum(l.credit_cents-l.debit_cents) FILTER(WHERE a.type IN ('REVENUE','EXPENSE') AND l.entry_date<d.reference_start),0)::text AS reference_prior
    FROM account a JOIN journal_line l ON l.company_id=a.company_id AND l.account_id=a.id CROSS JOIN dates d
    WHERE a.company_id=${actor.companyId}::uuid AND l.entry_date<=greatest(${input.asOf}::date,${input.referenceAsOf}::date)
    GROUP BY a.id,a.code,a.name_fr,a.name_en,a.type,a.subtype
   ) SELECT (SELECT coalesce(jsonb_agg(t ORDER BY t.code),'[]') FROM totals t) AS rows,
      to_char(current_start,'YYYY-MM-DD') AS current_start,to_char(reference_start,'YYYY-MM-DD') AS reference_start FROM dates`;
  if(!result)throw new AppError("reports.period");
  const rows=result.rows;
  const current=buildBalanceSheet(rows.map(r=>({...r,debitCents:BigInt(r.current_debit),creditCents:BigInt(r.current_credit)})),{priorEarningsCents:rows.reduce((a,r)=>a+BigInt(r.current_prior),0n)});
  const reference=buildBalanceSheet(rows.map(r=>({...r,debitCents:BigInt(r.reference_debit),creditCents:BigInt(r.reference_credit)})),{priorEarningsCents:rows.reduce((a,r)=>a+BigInt(r.reference_prior),0n)});
  return buildBalanceComparison(current,reference,{current:{asOf:input.asOf,fiscalYearStart:result.current_start},reference:{asOf:input.referenceAsOf,fiscalYearStart:result.reference_start}});
 });
}
