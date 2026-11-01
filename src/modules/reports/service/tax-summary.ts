import "server-only";
import { requireRole } from "@/modules/companies";
import { isValidIsoDate } from "@/modules/ledger";
import { AppError } from "@/platform/errors";
import { withCompany,type CompanyContext } from "@/platform/tenant";
import type { TaxSummary,TaxSummaryLine,TaxSummaryRow } from "../domain/tax-summary";
export const TAX_DETAIL_PAGE_SIZE=100;
export const TAX_EXPORT_MAX_LINES=200_000;
type Summary={id:string;code:string;nameFr:string;nameEn:string;collected:string;recoverable:string;adjustment:string;settlement:string};
type Detail=Omit<TaxSummaryLine,"debitCents"|"creditCents">&{debit:string;credit:string};
type Result={summary:Summary[];detail:Detail[];control:string;anomalies:number;n:number;page:number};

/** A single statement snapshot for summary, detail and ledger control. No return is filed or changed. */
export async function getTaxSummary(actor:CompanyContext,input:{from:string;to:string;page?:number},options:{exportAll?:boolean;maxLines?:number}={}):Promise<TaxSummary>{
 if(!isValidIsoDate(input.from)||!isValidIsoDate(input.to)||input.from>input.to)throw new AppError("reports.period");
 const exportLimit=Math.min(TAX_EXPORT_MAX_LINES,Math.max(1,Math.trunc(options.maxLines??TAX_EXPORT_MAX_LINES)||1));
 const requestedPage=Math.min(1_000_000,Math.max(1,Math.trunc(input.page??1)||1));
 return withCompany(actor,async tx=>{
  await requireRole(tx,"ledger.read");await requireRole(tx,"taxes.read");
  const [r]=await tx.$queryRaw<Result[]>`
   WITH period_lines AS MATERIALIZED (
    SELECT l.id,l.entry_id,l.tax_id,l.tax_box,l.entry_date,l.debit_cents,l.credit_cents,a.code AS account_code,a.subtype,e.entry_number,e.memo
    FROM journal_line l JOIN account a ON a.company_id=l.company_id AND a.id=l.account_id
    JOIN journal_entry e ON e.company_id=l.company_id AND e.id=l.entry_id
    WHERE l.company_id=${actor.companyId}::uuid AND l.entry_date BETWEEN ${input.from}::date AND ${input.to}::date
      AND (a.subtype='SALES_TAX' OR l.tax_id IS NOT NULL)
   ), summary AS (
    SELECT t.id,t.code,t.name_fr AS "nameFr",t.name_en AS "nameEn",
      coalesce(sum(p.credit_cents-p.debit_cents) FILTER(WHERE p.tax_box='COLLECTED'),0)::text AS collected,
      coalesce(sum(p.debit_cents-p.credit_cents) FILTER(WHERE p.tax_box='RECOVERABLE'),0)::text AS recoverable,
      coalesce(sum(p.credit_cents-p.debit_cents) FILTER(WHERE p.tax_box='ADJUSTMENT'),0)::text AS adjustment,
      coalesce(sum(p.credit_cents-p.debit_cents) FILTER(WHERE p.tax_box='SETTLEMENT'),0)::text AS settlement
    FROM tax t LEFT JOIN period_lines p ON p.tax_id=t.id
    WHERE t.company_id=${actor.companyId}::uuid GROUP BY t.id,t.code,t.name_fr,t.name_en,t.is_active HAVING t.is_active OR count(p.id)>0
   ), stats AS (
    SELECT coalesce(sum(credit_cents-debit_cents) FILTER(WHERE subtype='SALES_TAX'),0)::text AS control,
      count(*) FILTER(WHERE tax_id IS NULL OR tax_box IS NULL OR subtype<>'SALES_TAX')::int AS anomalies,
      count(*) FILTER(WHERE tax_id IS NOT NULL AND tax_box IS NOT NULL)::int AS n FROM period_lines
   ), page AS (
    SELECT *,least(${requestedPage},greatest(1,ceil(n::numeric/${TAX_DETAIL_PAGE_SIZE})::int)) AS page FROM stats
   ), detail AS (
    SELECT p.id,p.entry_id AS "entryId",p.entry_number::text AS "entryNumber",to_char(p.entry_date,'YYYY-MM-DD') AS date,t.code AS "taxCode",p.tax_box AS box,p.account_code AS "accountCode",p.memo,
      p.debit_cents::text AS debit,p.credit_cents::text AS credit
    FROM period_lines p JOIN tax t ON t.company_id=${actor.companyId}::uuid AND t.id=p.tax_id WHERE p.tax_box IS NOT NULL
    ORDER BY p.entry_date,p.entry_number,p.id
    LIMIT (CASE WHEN ${Boolean(options.exportAll)} AND (SELECT n FROM stats)>${exportLimit} THEN 0 ELSE ${options.exportAll?exportLimit:TAX_DETAIL_PAGE_SIZE} END)
    OFFSET (CASE WHEN ${Boolean(options.exportAll)} THEN 0 ELSE (SELECT (page-1)*${TAX_DETAIL_PAGE_SIZE} FROM page) END)
   )
   SELECT (SELECT coalesce(jsonb_agg(s ORDER BY s.code),'[]') FROM summary s) AS summary,
      (SELECT coalesce(jsonb_agg(d ORDER BY d.date,d."entryNumber"::bigint,d.id),'[]') FROM detail d) AS detail,control,anomalies,n,page FROM page`;
  if(!r)throw new AppError("reports.period");
  if(options.exportAll&&r.n>exportLimit)throw new AppError("reports.tooManyLines");
  const taxes:TaxSummaryRow[]=r.summary.map(s=>{const collectedCents=BigInt(s.collected),recoverableCents=BigInt(s.recoverable),adjustmentCents=BigInt(s.adjustment),settlementCents=BigInt(s.settlement);const netCents=collectedCents-recoverableCents+adjustmentCents;return {id:s.id,code:s.code,nameFr:s.nameFr,nameEn:s.nameEn,collectedCents,recoverableCents,adjustmentCents,settlementCents,netCents,movementCents:netCents+settlementCents};});
  const controlCents=BigInt(r.control),movement=taxes.reduce((a,t)=>a+t.movementCents,0n);
  return {from:input.from,to:input.to,taxes,controlCents,differenceCents:controlCents-movement,anomalyCount:r.anomalies,lineCount:r.n,page:options.exportAll?1:r.page,pageCount:Math.max(1,Math.ceil(r.n/TAX_DETAIL_PAGE_SIZE)),lines:r.detail.map(d=>({...d,debitCents:BigInt(d.debit),creditCents:BigInt(d.credit)}))};
 });
}
