import { afterAll, beforeAll, expect, it } from "vitest";
import type pg from "pg";
import { voidExpense, saveExpenseDraft, getExpenseDraft, postExpense, getExpense, listExpenses, deleteExpenseDraft } from "@/modules/purchases";
import { owner } from "./helpers";
import { seedWorld, W } from "./world";
const actor = { userId: W.userOwnerA, companyId: W.companyA };
const reader = { ...actor, userId: W.userReader };
const input = { paymentAccountId: W.bank, paymentMethod: "EFT", contactId: W.supplier, documentDate: "2026-06-01", dueDate: "2026-07-01", lines: [{ description: "Service", quantity: "1", unitPrice: "100", accountId: W.expenses, taxCodeId: W.taxCodeStandard }] };
let db: pg.Client;
beforeAll(async () => {
  db = await owner(); await seedWorld(db);
  await db.query("INSERT INTO number_sequence(company_id,key,next_value,prefix,padding) VALUES ($1,'JOURNAL_ENTRY',1,'J-',5),($1,'PURCHASE_DOCUMENT',1,'A-',5)", [W.companyA]);
});
afterAll(async () => { await db?.end(); });
it("posts exactly once under concurrent retries, freezes identities, and exposes read-only invoices", async () => {
  const id = await saveExpenseDraft(actor, input); const revision = (await getExpenseDraft(actor, id))!.revision;
  await expect(postExpense(reader,id,revision,"2026-06-01")).rejects.toThrow();
  await expect(postExpense({ userId: W.userOwnerB, companyId: W.companyB },id,revision,"2026-06-01")).rejects.toThrow();
  expect(await Promise.all([postExpense(actor,id,revision,"2026-06-01"),postExpense(actor,id,revision,"2026-06-01")])).toEqual([id,id]);
  const invoice = (await getExpense(reader,id))!;
  expect(invoice).toMatchObject({ status: "POSTED", number: "A-00001", totalCents: 11498n });
  expect((await listExpenses(reader)).some(i => i.id===id)).toBe(true);
  expect(await getExpenseDraft(actor,id)).toBeNull();
  await expect(deleteExpenseDraft(actor,id,revision)).rejects.toThrow();
  await expect(saveExpenseDraft(actor,{...input,revision},id)).rejects.toThrow();
  const lines = (await db.query("SELECT account_id,debit_cents::text,credit_cents::text,tax_box FROM journal_line WHERE entry_id=$1 ORDER BY line_no", [invoice.journalEntryId])).rows;
  expect(lines).toEqual([
    {account_id:W.bank,debit_cents:'0',credit_cents:'11498',tax_box:null},
    {account_id:W.expenses,debit_cents:'10000',credit_cents:'0',tax_box:null},
    ...[ [W.gstReceivable,'500'],[W.qstReceivable,'998'] ].map(([account_id,debit_cents])=>({account_id,debit_cents,credit_cents:'0',tax_box:'RECOVERABLE'})),
  ]);
  await db.query("UPDATE contact SET display_name='Changed',updated_at=now() WHERE id=$1",[W.supplier]);
  expect((await getExpense(reader,id))!.supplierSnapshot).toEqual(invoice.supplierSnapshot);
  expect((await db.query("SELECT count(*)::int AS n FROM journal_entry WHERE source_id=$1",[id])).rows[0].n).toBe(1);
});
it("refuses stale reviews and locked periods without consuming numbers", async () => {
  const id=await saveExpenseDraft(actor,input); const old=(await getExpenseDraft(actor,id))!;
  await saveExpenseDraft(actor,{...input,revision:old.revision,supplierReference:'Revised'},id);
  await expect(postExpense(actor,id,old.revision,'2026-06-01')).rejects.toThrow();
  const revision=(await getExpenseDraft(actor,id))!.revision;
  await expect(postExpense(actor,id,revision,'2026-05-01')).rejects.toThrow();
  const numbers=(await db.query("SELECT key,next_value::text FROM number_sequence WHERE company_id=$1 ORDER BY key",[W.companyA])).rows;
  await db.query("UPDATE fiscal_period SET status='LOCKED',locked_at=now(),locked_by_id=$2 WHERE company_id=$1 AND period_number=6",[W.companyA,W.userOwnerA]);
  await expect(postExpense(actor,id,revision,'2026-06-01')).rejects.toThrow();
  expect((await db.query("SELECT key,next_value::text FROM number_sequence WHERE company_id=$1 ORDER BY key",[W.companyA])).rows).toEqual(numbers);
  expect(await getExpenseDraft(actor,id)).not.toBeNull();
  await postExpense(actor,id,revision,'2026-07-01');
  expect((await getExpense(actor,id))!.number).toBe('A-00002');
});

it("voids once, retains immutable history and reverses every account and tax exactly", async () => {
  const invoice = (await listExpenses(actor)).find(i => i.number === "A-00001")!;
  const before = (await getExpense(actor,invoice.id))!;
  await expect(voidExpense(reader,invoice.id,"2026-07-02","Correction")).rejects.toThrow();
  await expect(voidExpense({userId:W.userOwnerB,companyId:W.companyB},invoice.id,"2026-07-02","Correction")).rejects.toThrow();
  for (const [date,reason] of [["2026-05-01","Correction"],["invalid","Correction"],["2026-07-02","   "],["2026-07-02","x".repeat(501)]]) {
    await expect(voidExpense(actor,invoice.id,date!,reason!)).rejects.toThrow();
  }
  // June was locked by the preceding test: a failed reversal must leave the original posted.
  await expect(voidExpense(actor,invoice.id,"2026-06-02","Correction")).rejects.toThrow();
  expect((await getExpense(actor,invoice.id))!.status).toBe("POSTED");
  expect(await Promise.all([1,2].map(()=>voidExpense(actor,invoice.id,"2026-07-02","Duplicate invoice")))).toEqual([invoice.id,invoice.id]);
  const after = (await getExpense(reader,invoice.id))!;
  expect(after).toMatchObject({status:"VOID",number:before.number,voidReason:"Duplicate invoice",totalCents:before.totalCents,supplierSnapshot:before.supplierSnapshot});
  expect(after.voidEntry?.entryDate.toISOString().slice(0,10)).toBe("2026-07-02");
  const sums=(await db.query("SELECT account_id,contact_id,tax_id,tax_box,sum(debit_cents-credit_cents)::text AS net FROM journal_line WHERE entry_id=ANY($1::uuid[]) GROUP BY account_id,contact_id,tax_id,tax_box",[[before.journalEntryId,after.voidEntryId]])).rows;
  expect(sums.length).toBe(4);
  expect(sums.every(r=>r.net==='0')).toBe(true);
  expect((await db.query("SELECT count(*)::int AS n FROM journal_entry WHERE reverses_entry_id=$1",[before.journalEntryId])).rows[0].n).toBe(1);
  expect((await listExpenses(reader)).find(i=>i.id===invoice.id)?.status).toBe("VOID");
  await expect(deleteExpenseDraft(actor,invoice.id,"unused")).rejects.toThrow();
  await expect(postExpense(actor,invoice.id,"unused","2026-07-02")).rejects.toThrow();
  const audit=(await db.query("SELECT after->>'status' AS status FROM audit_log WHERE entity_id=$1 AND action='row.update' ORDER BY occurred_at,id",[invoice.id])).rows;
  expect(audit.map(r=>r.status)).toContain("VOID");
});
it("rejects foreign funding accounts, unpaid-account types and future posting dates", async () => {
 for (const paymentAccountId of [W.bankB,W.payable,W.gstReceivable]) {
  await expect(saveExpenseDraft(actor,{...input,paymentAccountId})).rejects.toThrow();
 }
 const id=await saveExpenseDraft(actor,input);const reviewed=(await getExpenseDraft(actor,id))!;
 await expect(postExpense(actor,id,reviewed.revision,"2099-01-01")).rejects.toThrow();
 const { getDraft, listDrafts }=await import("@/modules/purchases");
 expect(await getDraft(actor,id)).toBeNull();
 expect((await listDrafts(actor)).drafts.some(d=>d.id===id)).toBe(false);
});
it("database rejects a balanced paid expense posted to unrelated accounts", async () => {
 const id=await saveExpenseDraft(actor,input);const reviewed=(await getExpenseDraft(actor,id))!;
 const { withCompany }=await import("@/platform/tenant");
 const { createPurchaseEntry }=await import("@/modules/ledger");
 await expect(withCompany(actor,async tx=>{
  const entry=await createPurchaseEntry(tx,actor,{documentId:id,date:"2026-07-01",memo:"Forged expense",lines:[{accountId:W.capital,debitCents:reviewed.totalCents,creditCents:0n},{accountId:W.bank,debitCents:0n,creditCents:reviewed.totalCents}]});
  await tx.$executeRaw`UPDATE purchase_document SET status='POSTED',number='FORGED',posting_date='2026-07-01',journal_entry_id=${entry.id}::uuid,posted_at=now(),posted_by_id=${actor.userId}::uuid,supplier_snapshot='{"name":"Supplier"}'::jsonb WHERE company_id=${actor.companyId}::uuid AND id=${id}::uuid`;
  await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
 })).rejects.toThrow();
 expect((await getExpenseDraft(actor,id))?.totalCents).toBe(reviewed.totalCents);
});
