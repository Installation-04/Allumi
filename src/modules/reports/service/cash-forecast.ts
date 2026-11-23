import "server-only";
import { requireRole } from "@/modules/companies";
import { todayIso } from "@/modules/ledger";
import { AppError } from "@/platform/errors";
import { withCompany,type CompanyContext } from "@/platform/tenant";
import { buildCashForecast,cashForecastRange,FORECAST_ACCOUNT_LIMIT,FORECAST_ITEM_LIMIT,FORECAST_PAGE_SIZE,type ForecastCashAccount,type ForecastOpenItem } from "../domain/cash-forecast";
type Raw={accounts:(Omit<ForecastCashAccount,'cents'>&{cents:string})[];items:(Omit<ForecastOpenItem,'cents'>&{cents:string})[];receivable:string;payable:string;future_count:number;future_cents:string};
/** All opening balances, dated open items, controls and exclusions share one SQL snapshot. */
export async function getCashForecast(actor:CompanyContext,input:{asOf:string;days:number;page?:number},options:{allRows?:boolean}={}){
 try{cashForecastRange(input.asOf,input.days);if(input.asOf>todayIso())throw new RangeError('future reference');}catch{throw new AppError('reports.forecastDate');}
 return withCompany(actor,async tx=>{
  await requireRole(tx,'ledger.read');await requireRole(tx,'sales.read');
  const period=cashForecastRange(input.asOf,input.days);
  const [r]=await tx.$queryRaw<Raw[]>`
   WITH cash_accounts AS(SELECT id,company_id,code,name_fr,name_en,is_active FROM account WHERE company_id=${actor.companyId}::uuid AND type='ASSET' AND subtype IN ('BANK','CASH') ORDER BY code LIMIT ${FORECAST_ACCOUNT_LIMIT+1}),
   balances AS(SELECT a.id,a.code,a.name_fr AS "nameFr",a.name_en AS "nameEn",a.is_active AS "isActive",coalesce(sum(j.debit_cents-j.credit_cents),0)::text AS cents FROM cash_accounts a LEFT JOIN journal_line j ON j.company_id=a.company_id AND j.account_id=a.id AND j.entry_date<=${input.asOf}::date GROUP BY a.id,a.code,a.name_fr,a.name_en,a.is_active),
   documents AS(
    SELECT d.id,'RECEIVABLE'::text AS ledger,d.kind::text AS kind,d.number,coalesce(d.billing_snapshot->>'name','—') AS party,to_char(d.issue_date,'YYYY-MM-DD') AS date,to_char(d.due_date,'YYYY-MM-DD') AS "dueDate",sales_document_open_cents(d.company_id,d.id,${input.asOf}::date)::text AS cents
    FROM sales_document d LEFT JOIN journal_entry v ON v.company_id=d.company_id AND v.id=d.void_entry_id WHERE d.company_id=${actor.companyId}::uuid AND d.kind IN ('INVOICE','CREDIT_NOTE') AND d.status IN ('POSTED','VOID') AND d.posting_date<=${input.asOf}::date AND(d.void_entry_id IS NULL OR v.entry_date>${input.asOf}::date)
    UNION ALL
    SELECT d.id,'PAYABLE',CASE WHEN d.kind='BILL' THEN 'INVOICE' ELSE 'CREDIT_NOTE' END,d.number,coalesce(d.supplier_snapshot->>'name','—'),to_char(d.document_date,'YYYY-MM-DD'),to_char(d.due_date,'YYYY-MM-DD'),purchase_document_open_cents(d.company_id,d.id,${input.asOf}::date)::text
    FROM purchase_document d LEFT JOIN journal_entry v ON v.company_id=d.company_id AND v.id=d.void_entry_id WHERE d.company_id=${actor.companyId}::uuid AND d.kind IN ('BILL','SUPPLIER_CREDIT') AND d.status IN ('POSTED','VOID') AND d.posting_date<=${input.asOf}::date AND(d.void_entry_id IS NULL OR v.entry_date>${input.asOf}::date)
    UNION ALL
    SELECT p.id,p.ledger::text,CASE WHEN (p.ledger='RECEIVABLE' AND p.direction='RECEIVED') OR(p.ledger='PAYABLE' AND p.direction='SENT') THEN 'PAYMENT' ELSE 'REFUND' END,p.number,'',to_char(p.payment_date,'YYYY-MM-DD'),NULL::text,payment_open_cents(p.company_id,p.id,${input.asOf}::date)::text
    FROM payment p LEFT JOIN journal_entry v ON v.company_id=p.company_id AND v.id=p.void_entry_id WHERE p.company_id=${actor.companyId}::uuid AND p.payment_date<=${input.asOf}::date AND(p.void_entry_id IS NULL OR v.entry_date>${input.asOf}::date)
   ), open_items AS(SELECT * FROM documents WHERE cents::numeric<>0 LIMIT ${FORECAST_ITEM_LIMIT+1}),
   controls AS(SELECT coalesce(sum(j.debit_cents-j.credit_cents) FILTER(WHERE a.subtype='ACCOUNTS_RECEIVABLE'),0)::text AS receivable,coalesce(sum(j.credit_cents-j.debit_cents) FILTER(WHERE a.subtype='ACCOUNTS_PAYABLE'),0)::text AS payable FROM journal_line j JOIN account a ON a.company_id=j.company_id AND a.id=j.account_id WHERE j.company_id=${actor.companyId}::uuid AND j.entry_date<=${input.asOf}::date AND a.subtype IN ('ACCOUNTS_RECEIVABLE','ACCOUNTS_PAYABLE')),
   future AS(SELECT j.entry_id,sum(j.debit_cents-j.credit_cents) AS cents FROM journal_line j JOIN cash_accounts a ON a.company_id=j.company_id AND a.id=j.account_id WHERE j.company_id=${actor.companyId}::uuid AND j.entry_date>${input.asOf}::date AND j.entry_date<=${period.to}::date GROUP BY j.entry_id HAVING sum(j.debit_cents-j.credit_cents)<>0)
   SELECT coalesce((SELECT jsonb_agg(a ORDER BY a.code) FROM balances a),'[]'::jsonb) AS accounts,coalesce((SELECT jsonb_agg(o) FROM open_items o),'[]'::jsonb) AS items,c.*,(SELECT count(*)::int FROM future) AS future_count,coalesce((SELECT sum(cents)::text FROM future),'0') AS future_cents FROM controls c`;
  if(!r)throw new AppError('reports.forecastSource');
  if(r.accounts.length>FORECAST_ACCOUNT_LIMIT||r.items.length>FORECAST_ITEM_LIMIT)throw new AppError('reports.forecastLimit');
  let report;
  try{report=buildCashForecast({asOf:input.asOf,days:input.days,accounts:r.accounts.map(a=>({...a,cents:BigInt(a.cents)})),items:r.items.map(i=>({...i,cents:BigInt(i.cents)})),receivableControlCents:BigInt(r.receivable),payableControlCents:BigInt(r.payable),futureCashCount:r.future_count,futureCashCents:BigInt(r.future_cents)});}catch{throw new AppError('reports.forecastSource');}
  const pageCount=Math.max(1,Math.ceil(report.items.length/FORECAST_PAGE_SIZE)),page=options.allRows?1:Math.min(pageCount,Number.isSafeInteger(input.page)&&input.page!>0?input.page!:1);
  return {...report,items:options.allRows?report.items:report.items.slice((page-1)*FORECAST_PAGE_SIZE,page*FORECAST_PAGE_SIZE),itemCount:report.items.length,page,pageCount:options.allRows?1:pageCount};
 });
}
