import { randomUUID } from "node:crypto";
import { afterAll,beforeAll,expect,it } from "vitest";
import type pg from "pg";
import { getPayablesAging } from "@/modules/reports";
import { recordDisbursement,voidDisbursement } from "@/modules/payments";
import { saveDraft,getDraft,postBill,getBill,voidBill,saveCreditDraft,getCreditDraft,postCreditNote,voidCreditNote,saveExpenseDraft,getExpenseDraft,postExpense } from "@/modules/purchases";
import { owner } from "./helpers";
import { seedWorld,W } from "./world";
const actor={userId:W.userOwnerA,companyId:W.companyA};
let entrySeq=900_000;
let db:pg.Client,first:string,second:string,payment:string,credit:string;
async function bill(date:string,due:string){const id=await saveDraft(actor,{contactId:W.supplier,documentDate:date,dueDate:due,lines:[{description:"Supplies",quantity:"1",unitPrice:"100",accountId:W.expenses,taxCodeId:W.taxCodeStandard}]});await postBill(actor,id,(await getDraft(actor,id))!.revision,date);return id;}
const report=(date:string)=>getPayablesAging(actor,{asOf:date});
beforeAll(async()=>{
 db=await owner();await seedWorld(db);
 await db.query("INSERT INTO number_sequence(company_id,key,next_value,prefix,padding) VALUES ($1,'JOURNAL_ENTRY',1,'J-',5),($1,'PURCHASE_DOCUMENT',1,'A-',5),($1,'PAYMENT_SENT',1,'D-',5)",[W.companyA]);
 first=await bill("2026-06-01","2026-07-01");second=await bill("2026-06-10","2026-06-20");
 payment=(await recordDisbursement(actor,{billId:first,amountCents:"5000",expectedOpenCents:"11498",date:"2026-07-10",accountId:W.bank,method:"EFT"},{now:new Date("2026-12-31")})).id;
 const source=(await getBill(actor,second))!;
 credit=await saveCreditDraft(actor,second,{documentDate:"2026-07-01",memo:"Correction",lines:[{lineId:source.lines[0]!.id,amount:"25"}]});
 await postCreditNote(actor,credit,(await getCreditDraft(actor,credit))!.revision,"2026-07-01");
 await voidDisbursement(actor,payment,{date:"2026-08-01",reason:"Wrong payment"});
 await voidCreditNote(actor,credit,"2026-08-05","Wrong credit");
 await voidBill(actor,first,"2026-09-01","Cancelled bill");
});
afterAll(async()=>{await db?.end();});
it("reconstructs the exact historical balance despite later payment, credit and bill reversals",async()=>{
 for(const [asOf,total] of [["2026-05-31",0n],["2026-06-01",11498n],["2026-06-30",22996n],["2026-07-01",20122n],["2026-07-31",15122n],["2026-08-01",20122n],["2026-08-05",22996n],["2026-09-01",11498n]] as const){const r=await report(asOf);expect(r.totalCents,asOf).toBe(total);expect(r.controlCents,asOf).toBe(total);expect(r.differenceCents,asOf).toBe(0n);}
 const july=await report("2026-07-31");expect(july.buckets).toEqual({current:0n,d1_30:6498n,d31_60:8624n,d61_90:0n,d91_plus:0n});expect(july.unappliedCents).toBe(0n);
 expect(july.customers[0]!.items.map(i=>i.id).sort()).toEqual([first,second].sort());
 const today=await report("2026-09-01");expect(today.customers[0]!.items.map(i=>i.id)).toEqual([second]);
});
it("excludes drafts and paid expenses and retains inactive suppliers",async()=>{
 await saveDraft(actor,{contactId:W.supplier,documentDate:"2026-04-01",dueDate:"2026-05-01",lines:[{description:"Draft",quantity:"1",unitPrice:"999",accountId:W.expenses,taxCodeId:W.taxCodeStandard}]});
 const id=await saveExpenseDraft(actor,{contactId:W.supplier,documentDate:"2026-06-01",paymentAccountId:W.bank,paymentMethod:"EFT",lines:[{description:"Paid",quantity:"1",unitPrice:"10",accountId:W.expenses,taxCodeId:W.taxCodeStandard}]});await postExpense(actor,id,(await getExpenseDraft(actor,id))!.revision,"2026-06-01");
 await db.query("UPDATE contact SET is_active=false WHERE id=$1",[W.supplier]);
 expect((await report("2026-07-31")).totalCents).toBe(15122n);expect((await report("2026-07-31")).differenceCents).toBe(0n);
});
it("works with accounting-only read access and frozen supplier names, and refuses revoked or foreign contexts",async()=>{
 const reader={...actor,userId:W.userReader};
 await db.query("UPDATE membership SET module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader,JSON.stringify({accounting:"read",sales:"none",contacts:"none"})]);
 const r=await getPayablesAging(reader,{asOf:"2026-07-31"});expect(r.totalCents).toBe(15122n);expect(r.differenceCents).toBe(0n);expect(r.customers[0]!.contactName).toBe("Fournisseur Fictif");
 expect((await getPayablesAging({userId:W.userOwnerB,companyId:W.companyB},{asOf:"2026-07-31"})).customers).toEqual([]);
 await expect(getPayablesAging({userId:W.userOwnerB,companyId:W.companyA},{asOf:"2026-07-31"})).rejects.toThrow();
 await db.query("UPDATE membership SET module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader,JSON.stringify({accounting:"none"})]);
 await expect(getPayablesAging(reader,{asOf:"2026-07-31"})).rejects.toThrow();
 await expect(report("2026-02-30")).rejects.toMatchObject({key:"reports.period"});
});

async function loosePayment(o: { direction: "RECEIVED" | "SENT"; ledger: "RECEIVABLE" | "PAYABLE"; contact: string; date: string; cents: number }): Promise<string> {
  const id = randomUUID();
  const entryId = randomUUID();
  const received = o.direction === "RECEIVED";
  const control = o.ledger === "RECEIVABLE" ? W.receivable : W.payable;
  await db.query("BEGIN");
  try {
    await db.query(
      "INSERT INTO journal_entry (id, company_id, entry_number, entry_date, fiscal_period_id, source_type, source_id, created_by_id) SELECT $1, $2, $3, $4::date, id, 'PAYMENT', $5, $6 FROM fiscal_period WHERE company_id = $2 AND $4::date BETWEEN start_date AND end_date",
      [entryId, W.companyA, ++entrySeq, o.date, id, W.userOwnerA],
    );
    await db.query(
      "INSERT INTO journal_line (id, company_id, entry_id, line_no, account_id, debit_cents, credit_cents, entry_date) VALUES (gen_random_uuid(), $1, $2, 1, $3, $4, $5, $6::date)",
      [W.companyA, entryId, W.bank, received ? o.cents : 0, received ? 0 : o.cents, o.date],
    );
    await db.query(
      "INSERT INTO journal_line (id, company_id, entry_id, line_no, account_id, debit_cents, credit_cents, contact_id, entry_date) VALUES (gen_random_uuid(), $1, $2, 2, $3, $4, $5, $6, $7::date)",
      [W.companyA, entryId, control, received ? 0 : o.cents, received ? o.cents : 0, o.contact, o.date],
    );
    await db.query(
      "INSERT INTO payment (id, company_id, direction, ledger, contact_id, payment_date, amount_cents, account_id, method, journal_entry_id, created_by_id, updated_at) VALUES ($1, $2, $3::payment_direction, $4::payment_ledger, $5, $6::date, $7, $8, 'EFT', $9, $10, now())",
      [id, W.companyA, o.direction, o.ledger, o.contact, o.date, o.cents, W.bank, entryId, W.userOwnerA],
    );
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
  return id;
}

it("shows unapplied supplier payments and refunds separately and ignores the receivable ledger",async()=>{
 await db.query("UPDATE contact SET is_active=true WHERE id=$1",[W.supplier]);
 await loosePayment({direction:"SENT",ledger:"PAYABLE",contact:W.supplier,date:"2026-06-15",cents:1000});
 await loosePayment({direction:"RECEIVED",ledger:"PAYABLE",contact:W.supplier,date:"2026-06-16",cents:400});
 await loosePayment({direction:"RECEIVED",ledger:"RECEIVABLE",contact:W.customer,date:"2026-06-16",cents:700});
 const r=await report("2026-07-31");expect(r.unappliedCents).toBe(-600n);expect(r.totalCents).toBe(14522n);expect(r.differenceCents).toBe(0n);
 expect(r.customers[0]!.items.filter(i=>i.bucket===null).map(i=>i.cents).sort()).toEqual([-1000n,400n].sort());
 expect((await report("2026-06-14")).unappliedCents).toBe(0n);
});

it("reports unexplained payable ledger amounts instead of hiding an imbalance",async()=>{
 // Simulate an imported ledger inconsistency in this disposable database only.
    const id = randomUUID();
    await db.query("BEGIN");
    try {
      await db.query("ALTER TABLE journal_entry DISABLE TRIGGER journal_entry_complete");
      await db.query("ALTER TABLE journal_line DISABLE TRIGGER journal_line_balanced");
      await db.query(
        "INSERT INTO journal_entry (id, company_id, entry_number, entry_date, fiscal_period_id, source_type, source_id, created_by_id) SELECT $1, $2, $3, '2026-05-01', id, 'PAYMENT', $5, $4 FROM fiscal_period WHERE company_id = $2 AND start_date = '2026-05-01'",
        [id, W.companyA, ++entrySeq, W.userOwnerA, randomUUID()],
      );
      await db.query("INSERT INTO journal_line (id, company_id, entry_id, line_no, account_id, debit_cents, credit_cents, contact_id, entry_date) VALUES (gen_random_uuid(), $1, $2, 1, $3, 1234, 0, NULL, '2026-05-01'), (gen_random_uuid(), $1, $2, 2, $4, 0, 1234, $5, '2026-05-01')", [W.companyA, id, W.expenses, W.payable, W.supplier]);
      await db.query("ALTER TABLE journal_entry ENABLE TRIGGER journal_entry_complete");
      await db.query("ALTER TABLE journal_line ENABLE TRIGGER journal_line_balanced");
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    }
 const before=await report("2026-04-30"),after=await report("2026-05-01");
 expect(before.differenceCents).toBe(0n);expect(after.totalCents).toBe(0n);expect(after.customers).toEqual([]);expect(after.differenceCents).toBe(1234n);
});
