import { afterAll, beforeAll, expect, it } from "vitest";
import type pg from "pg";
import { voidBill, saveDraft, getDraft, postBill, getBill, listBills, deleteDraft } from "@/modules/purchases";
import { owner } from "./helpers";
import { seedWorld, W } from "./world";
const actor = { userId: W.userOwnerA, companyId: W.companyA };
const reader = { ...actor, userId: W.userReader };
const input = { contactId: W.supplier, documentDate: "2026-06-01", dueDate: "2026-07-01", lines: [{ description: "Service", quantity: "1", unitPrice: "100", accountId: W.expenses, taxCodeId: W.taxCodeStandard }] };
let db: pg.Client;
beforeAll(async () => {
  db = await owner(); await seedWorld(db);
  await db.query("INSERT INTO number_sequence(company_id,key,next_value,prefix,padding) VALUES ($1,'JOURNAL_ENTRY',1,'J-',5),($1,'PURCHASE_DOCUMENT',1,'A-',5)", [W.companyA]);
});
afterAll(async () => { await db?.end(); });
it("posts exactly once under concurrent retries, freezes identities, and exposes read-only invoices", async () => {
  const id = await saveDraft(actor, input); const revision = (await getDraft(actor, id))!.revision;
  await expect(postBill(reader,id,revision,"2026-06-01")).rejects.toThrow();
  await expect(postBill({ userId: W.userOwnerB, companyId: W.companyB },id,revision,"2026-06-01")).rejects.toThrow();
  expect(await Promise.all([postBill(actor,id,revision,"2026-06-01"),postBill(actor,id,revision,"2026-06-01")])).toEqual([id,id]);
  const invoice = (await getBill(reader,id))!;
  expect(invoice).toMatchObject({ status: "POSTED", number: "A-00001", totalCents: 11498n });
  expect((await listBills(reader)).some(i => i.id===id)).toBe(true);
  expect(await getDraft(actor,id)).toBeNull();
  await expect(deleteDraft(actor,id,revision)).rejects.toThrow();
  await expect(saveDraft(actor,{...input,revision},id)).rejects.toThrow();
  const lines = (await db.query("SELECT account_id,debit_cents::text,credit_cents::text,tax_box FROM journal_line WHERE entry_id=$1 ORDER BY line_no", [invoice.journalEntryId])).rows;
  expect(lines).toEqual([
    {account_id:W.payable,debit_cents:'0',credit_cents:'11498',tax_box:null},
    {account_id:W.expenses,debit_cents:'10000',credit_cents:'0',tax_box:null},
    ...[ [W.gstReceivable,'500'],[W.qstReceivable,'998'] ].map(([account_id,debit_cents])=>({account_id,debit_cents,credit_cents:'0',tax_box:'RECOVERABLE'})),
  ]);
  await db.query("UPDATE contact SET display_name='Changed',updated_at=now() WHERE id=$1",[W.supplier]);
  expect((await getBill(reader,id))!.supplierSnapshot).toEqual(invoice.supplierSnapshot);
  expect((await db.query("SELECT count(*)::int AS n FROM journal_entry WHERE source_id=$1",[id])).rows[0].n).toBe(1);
});
it("refuses stale reviews and locked periods without consuming numbers", async () => {
  const id=await saveDraft(actor,input); const old=(await getDraft(actor,id))!;
  await saveDraft(actor,{...input,revision:old.revision,supplierReference:'Revised'},id);
  await expect(postBill(actor,id,old.revision,'2026-06-01')).rejects.toThrow();
  const revision=(await getDraft(actor,id))!.revision;
  await expect(postBill(actor,id,revision,'2026-05-01')).rejects.toThrow();
  const numbers=(await db.query("SELECT key,next_value::text FROM number_sequence WHERE company_id=$1 ORDER BY key",[W.companyA])).rows;
  await db.query("UPDATE fiscal_period SET status='LOCKED',locked_at=now(),locked_by_id=$2 WHERE company_id=$1 AND period_number=6",[W.companyA,W.userOwnerA]);
  await expect(postBill(actor,id,revision,'2026-06-01')).rejects.toThrow();
  expect((await db.query("SELECT key,next_value::text FROM number_sequence WHERE company_id=$1 ORDER BY key",[W.companyA])).rows).toEqual(numbers);
  expect(await getDraft(actor,id)).not.toBeNull();
  await postBill(actor,id,revision,'2026-07-01');
  expect((await getBill(actor,id))!.number).toBe('A-00002');
});

it("voids once, retains immutable history and reverses every account and tax exactly", async () => {
  const invoice = (await listBills(actor)).find(i => i.number === "A-00001")!;
  const before = (await getBill(actor,invoice.id))!;
  await expect(voidBill(reader,invoice.id,"2026-07-02","Correction")).rejects.toThrow();
  await expect(voidBill({userId:W.userOwnerB,companyId:W.companyB},invoice.id,"2026-07-02","Correction")).rejects.toThrow();
  for (const [date,reason] of [["2026-05-01","Correction"],["invalid","Correction"],["2026-07-02","   "],["2026-07-02","x".repeat(501)]]) {
    await expect(voidBill(actor,invoice.id,date!,reason!)).rejects.toThrow();
  }
  // June was locked by the preceding test: a failed reversal must leave the original posted.
  await expect(voidBill(actor,invoice.id,"2026-06-02","Correction")).rejects.toThrow();
  expect((await getBill(actor,invoice.id))!.status).toBe("POSTED");
  expect(await Promise.all([1,2].map(()=>voidBill(actor,invoice.id,"2026-07-02","Duplicate invoice")))).toEqual([invoice.id,invoice.id]);
  const after = (await getBill(reader,invoice.id))!;
  expect(after).toMatchObject({status:"VOID",number:before.number,voidReason:"Duplicate invoice",totalCents:before.totalCents,supplierSnapshot:before.supplierSnapshot});
  expect(after.voidEntry?.entryDate.toISOString().slice(0,10)).toBe("2026-07-02");
  const sums=(await db.query("SELECT account_id,contact_id,tax_id,tax_box,sum(debit_cents-credit_cents)::text AS net FROM journal_line WHERE entry_id=ANY($1::uuid[]) GROUP BY account_id,contact_id,tax_id,tax_box",[[before.journalEntryId,after.voidEntryId]])).rows;
  expect(sums.length).toBe(4);
  expect(sums.every(r=>r.net==='0')).toBe(true);
  expect((await db.query("SELECT count(*)::int AS n FROM journal_entry WHERE reverses_entry_id=$1",[before.journalEntryId])).rows[0].n).toBe(1);
  expect((await listBills(reader)).find(i=>i.id===invoice.id)?.status).toBe("VOID");
  await expect(deleteDraft(actor,invoice.id,"unused")).rejects.toThrow();
  await expect(postBill(actor,invoice.id,"unused","2026-07-02")).rejects.toThrow();
  const audit=(await db.query("SELECT after->>'status' AS status FROM audit_log WHERE entity_id=$1 AND action='row.update' ORDER BY occurred_at,id",[invoice.id])).rows;
  expect(audit.map(r=>r.status)).toContain("VOID");
});
it("posts an exempt bill without tax lines and allows reference reuse after voiding", async () => {
  const exempt = { ...input, documentDate: "2026-07-01", supplierReference: "EXEMPT-1", lines: input.lines.map(l => ({ ...l, taxCodeId: W.taxCodeExempt })) };
  const id = await saveDraft(actor, exempt);
  const draft = (await getDraft(actor, id))!;
  expect(draft.totalCents).toBe(10000n);
  expect(draft.taxes).toHaveLength(0);
  await postBill(actor, id, draft.revision, "2026-07-01");
  await expect(saveDraft(actor, exempt)).rejects.toMatchObject({ key: "purchases.duplicate" });
  await voidBill(actor, id, "2026-07-02", "Duplicate supplier document");
  await expect(saveDraft(actor, exempt)).resolves.toBeTypeOf("string");
});
