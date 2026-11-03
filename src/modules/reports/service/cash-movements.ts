import "server-only";
import { requireRole } from "@/modules/companies";
import { formatNumber,isValidIsoDate } from "@/modules/ledger";
import { AppError } from "@/platform/errors";
import { withCompany,type CompanyContext } from "@/platform/tenant";
import { CASH_FIGURES,cashTotals,type CashAccountTotals,type CashFigures,type CashMovement,type CashMovementsReport } from "../domain/cash-movements";
export const CASH_PAGE_SIZE=100;
export const CASH_EXPORT_LIMIT=200_000;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type AccountRow=Omit<CashAccountTotals,typeof CASH_FIGURES[number]>&Record<typeof CASH_FIGURES[number],string>;
type DetailRow={id:string;entry_id:string;entry_number:string;entry_date:string;account_id:string;account_code:string;memo:string|null;kind:CashMovement["kind"];debit:string;credit:string};
/** Both cumulative controls, entry classification and paginated detail share one SQL snapshot. */
export async function getCashMovements(actor:CompanyContext,input:{from:string;to:string;accountId?:string|null;page?:number},options:{allRows?:boolean;maxLines?:number}={}):Promise<CashMovementsReport>{
 if(!isValidIsoDate(input.from)||!isValidIsoDate(input.to)||input.from>input.to)throw new AppError("reports.period");
 if(input.accountId!=null&&!UUID.test(input.accountId))throw new AppError("reports.account");
 const accountId=input.accountId?.toLowerCase()??null;
 const requestedPage=Number.isSafeInteger(input.page)&&input.page!>0?Math.min(input.page!,100_000):1;
 const all=options.allRows===true,maxLines=Math.max(0,Math.min(CASH_EXPORT_LIMIT,Math.trunc(options.maxLines??CASH_EXPORT_LIMIT)||0));
 return withCompany(actor,async tx=>{
  await requireRole(tx,"ledger.read");
  const [r]=await tx.$queryRaw<{accounts:AccountRow[];details:DetailRow[];n:number;page:number;page_count:number;mixed_count:number;prefix:string;padding:number}[]>`
   WITH cash_accounts AS (
    SELECT id,company_id,code,name_fr,name_en,is_active FROM account
     WHERE company_id=${actor.companyId}::uuid AND type='ASSET' AND subtype IN ('BANK','CASH')
   ), period_lines AS (
    SELECT l.* FROM journal_line l JOIN cash_accounts a ON a.company_id=l.company_id AND a.id=l.account_id
     WHERE l.company_id=${actor.companyId}::uuid AND l.entry_date BETWEEN ${input.from}::date AND ${input.to}::date
   ), entries AS (
    SELECT l.entry_id,
     bool_and(a.id IS NOT NULL) AND count(DISTINCT a.id)>1 AS internal,
     coalesce(sum(l.debit_cents) FILTER(WHERE a.id IS NOT NULL),0)>0 AND coalesce(sum(l.credit_cents) FILTER(WHERE a.id IS NOT NULL),0)>0 AS two_way
    FROM journal_line l JOIN (SELECT DISTINCT entry_id FROM period_lines) p ON p.entry_id=l.entry_id
     LEFT JOIN cash_accounts a ON a.company_id=l.company_id AND a.id=l.account_id
    WHERE l.company_id=${actor.companyId}::uuid GROUP BY l.entry_id
   ), account_totals AS (
    SELECT a.id,a.code,a.name_fr AS "nameFr",a.name_en AS "nameEn",a.is_active AS "isActive",
     coalesce(sum(l.debit_cents-l.credit_cents) FILTER(WHERE l.entry_date<${input.from}::date),0)::text AS "openingCents",
     coalesce(sum(l.debit_cents) FILTER(WHERE l.entry_date>=${input.from}::date AND NOT e.internal),0)::text AS "incomingCents",
     coalesce(sum(l.credit_cents) FILTER(WHERE l.entry_date>=${input.from}::date AND NOT e.internal),0)::text AS "outgoingCents",
     coalesce(sum(l.debit_cents) FILTER(WHERE e.internal),0)::text AS "transferInCents",
     coalesce(sum(l.credit_cents) FILTER(WHERE e.internal),0)::text AS "transferOutCents",
     coalesce(sum(l.debit_cents-l.credit_cents),0)::text AS "closingCents"
    FROM cash_accounts a LEFT JOIN journal_line l ON l.company_id=a.company_id AND l.account_id=a.id AND l.entry_date<=${input.to}::date
     LEFT JOIN entries e ON e.entry_id=l.entry_id GROUP BY a.id,a.code,a.name_fr,a.name_en,a.is_active
   ), scoped AS (
    SELECT l.id,l.entry_id,e.entry_number::text AS entry_number,to_char(l.entry_date,'YYYY-MM-DD') AS entry_date,l.line_no,l.account_id,a.code AS account_code,e.memo,
     CASE WHEN c.internal THEN 'transfer' WHEN c.two_way THEN 'mixed' ELSE 'movement' END AS kind,
     l.debit_cents::text AS debit,l.credit_cents::text AS credit
    FROM period_lines l JOIN journal_entry e ON e.company_id=l.company_id AND e.id=l.entry_id
     JOIN cash_accounts a ON a.company_id=l.company_id AND a.id=l.account_id JOIN entries c ON c.entry_id=l.entry_id
    WHERE ${accountId}::uuid IS NULL OR l.account_id=${accountId}::uuid
   ), counted AS (
    SELECT count(*)::int AS n,count(DISTINCT entry_id) FILTER(WHERE kind='mixed')::int AS mixed_count FROM scoped
   ), pages AS (
    SELECT n,mixed_count,greatest(1,ceil(n::numeric/${CASH_PAGE_SIZE})::int) AS page_count,
     CASE WHEN ${all} THEN 1 ELSE least(${requestedPage},greatest(1,ceil(n::numeric/${CASH_PAGE_SIZE})::int)) END AS page FROM counted
   ) SELECT (SELECT coalesce(jsonb_agg(a ORDER BY a.code),'[]') FROM account_totals a) AS accounts,
     (SELECT coalesce(jsonb_agg(d ORDER BY d.entry_date,d.entry_number::bigint,d.line_no),'[]') FROM (
       SELECT s.* FROM scoped s CROSS JOIN pages p WHERE NOT ${all} OR p.n<=${maxLines}
        ORDER BY s.entry_date,s.entry_number::bigint,s.line_no
        LIMIT ${all?maxLines:CASH_PAGE_SIZE} OFFSET (CASE WHEN ${all} THEN 0 ELSE (SELECT (page-1)*${CASH_PAGE_SIZE} FROM pages) END)
     ) d) AS details,p.*,
     coalesce((SELECT prefix FROM number_sequence WHERE company_id=${actor.companyId}::uuid AND key='JOURNAL_ENTRY'),'') AS prefix,
     coalesce((SELECT padding FROM number_sequence WHERE company_id=${actor.companyId}::uuid AND key='JOURNAL_ENTRY'),0) AS padding FROM pages p`;
  if(!r)throw new AppError("reports.period");
  if(accountId&&!r.accounts.some(a=>a.id===accountId))throw new AppError("reports.account");
  if(all&&r.n>maxLines)throw new AppError("reports.tooManyLines");
  const byAccount=r.accounts.filter(a=>!accountId||a.id===accountId).map(a=>({...a,...(Object.fromEntries(CASH_FIGURES.map(k=>[k,BigInt(a[k])])) as CashFigures)}));
  const lines=r.details.map(m=>({id:m.id,entryId:m.entry_id,entryNumber:formatNumber(r.prefix,r.padding,BigInt(m.entry_number)),date:m.entry_date,accountId:m.account_id,accountCode:m.account_code,memo:m.memo,kind:m.kind,debitCents:BigInt(m.debit),creditCents:BigInt(m.credit)}));
  return {from:input.from,to:input.to,accounts:r.accounts.map(({id,code,nameFr,nameEn,isActive})=>({id,code,nameFr,nameEn,isActive})),selectedAccountId:accountId,totals:cashTotals(byAccount),byAccount,lines,lineCount:r.n,mixedEntryCount:r.mixed_count,page:r.page,pageCount:all?1:r.page_count};
 });
}
