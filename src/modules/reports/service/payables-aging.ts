import "server-only";
import { requireRole } from "@/modules/companies";
import { isValidIsoDate } from "@/modules/ledger";
import { AppError } from "@/platform/errors";
import { withCompany, type CompanyContext } from "@/platform/tenant";
import { buildAging, type AgingItem } from "../domain/aging";
import type { ReceivablesAging } from "./aging";

// Both reports share invoice/credit/payment/refund presentation kinds. Payable invoices
// are bills; a sent payment reduces the liability and an unapplied received refund adds to it.
export type PayablesAging = ReceivablesAging;
type Row = {kind:AgingItem["kind"]|null;id:string|null;contact_id:string;contact_name:string;number:string|null;date:Date|null;due_date:Date|null;open_cents:bigint;control_cents:bigint};
const iso=(date:Date)=>date.toISOString().slice(0,10);

/** End-of-day payable subledger, including allocations and their reversals as they stood that day. */
export async function getPayablesAging(actor:CompanyContext,input:{asOf:string}):Promise<PayablesAging> {
  if(!isValidIsoDate(input.asOf))throw new AppError("reports.period");
  return withCompany(actor,async tx=>{
    await requireRole(tx,"ledger.read");
    const rows=await tx.$queryRaw<Row[]>`
      WITH names AS (
        SELECT DISTINCT ON (contact_id) contact_id,supplier_snapshot->>'name' AS name
        FROM purchase_document WHERE company_id=${actor.companyId}::uuid AND kind='BILL' AND status IN ('POSTED','VOID') AND posting_date<=${input.asOf}::date
        ORDER BY contact_id,posting_date DESC,id DESC
      ), open_items AS (
        SELECT CASE WHEN d.kind='BILL' THEN 'INVOICE' ELSE 'CREDIT_NOTE' END AS kind,d.id,d.contact_id,d.number,d.document_date AS date,d.due_date,
          purchase_document_open_cents(d.company_id,d.id,${input.asOf}::date) AS open_cents
        FROM purchase_document d LEFT JOIN journal_entry v ON v.company_id=d.company_id AND v.id=d.void_entry_id
        WHERE d.company_id=${actor.companyId}::uuid AND d.kind IN ('BILL','SUPPLIER_CREDIT') AND d.status IN ('POSTED','VOID') AND d.posting_date<=${input.asOf}::date
          AND (d.void_entry_id IS NULL OR v.entry_date>${input.asOf}::date)
        UNION ALL
        SELECT CASE WHEN p.direction='SENT' THEN 'PAYMENT' ELSE 'REFUND' END,p.id,p.contact_id,p.number,p.payment_date,NULL::date,
          payment_open_cents(p.company_id,p.id,${input.asOf}::date)
        FROM payment p LEFT JOIN journal_entry v ON v.company_id=p.company_id AND v.id=p.void_entry_id
        WHERE p.company_id=${actor.companyId}::uuid AND p.ledger='PAYABLE' AND p.payment_date<=${input.asOf}::date
          AND (p.void_entry_id IS NULL OR v.entry_date>${input.asOf}::date)
      ), control AS (
        SELECT coalesce(sum(l.credit_cents-l.debit_cents),0)::bigint AS cents
        FROM journal_line l JOIN account a ON a.company_id=l.company_id AND a.id=l.account_id
        WHERE l.company_id=${actor.companyId}::uuid AND a.subtype='ACCOUNTS_PAYABLE' AND l.entry_date<=${input.asOf}::date
      )
      SELECT o.*,coalesce(c.display_name,n.name,'—') AS contact_name,v.cents AS control_cents
      FROM control v LEFT JOIN open_items o ON o.open_cents<>0
      LEFT JOIN contact c ON c.company_id=${actor.companyId}::uuid AND c.id=o.contact_id
      LEFT JOIN names n ON n.contact_id=o.contact_id
      `;
    const items:AgingItem[]=rows.flatMap(r=>r.id?[{kind:r.kind!,id:r.id,contactId:r.contact_id,contactName:r.contact_name,number:r.number,date:iso(r.date!),dueDate:r.due_date?iso(r.due_date):null,
      cents:r.kind==="INVOICE"||r.kind==="REFUND"?r.open_cents:-r.open_cents}]:[]);
    const aging=buildAging(items,input.asOf);
    // Items and ledger control share one PostgreSQL statement snapshot.
    const controlCents=rows[0]?.control_cents??0n;
    return {...aging,asOf:input.asOf,controlCents,differenceCents:controlCents-aging.totalCents};
  });
}
