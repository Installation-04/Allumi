import { afterAll, beforeAll, expect, it } from "vitest";
import type pg from "pg";
import { saveDraft, getDraft, postInvoice, getInvoice, listInvoices, deleteDraft } from "@/modules/sales";
import { owner } from "./helpers";
import { seedWorld, W } from "./world";
const actor = { userId: W.userOwnerA, companyId: W.companyA };
const reader = { ...actor, userId: W.userReader };
const input = { contactId: W.customer, issueDate: "2026-06-01", dueDate: "2026-07-01", lines: [{ description: "Service", quantity: "1", unitPrice: "100", accountId: W.sales, taxCodeId: W.taxCodeStandard }] };
let db: pg.Client;
beforeAll(async () => {
  db = await owner(); await seedWorld(db);
  await db.query("INSERT INTO number_sequence(company_id,key,next_value,prefix,padding) VALUES ($1,'JOURNAL_ENTRY',1,'J-',5),($1,'INVOICE',1,'F-',5)", [W.companyA]);
});
afterAll(async () => { await db?.end(); });
it("posts exactly once under concurrent retries, freezes identities, and exposes read-only invoices", async () => {
  const id = await saveDraft(actor, input); const revision = (await getDraft(actor, id))!.revision;
  await expect(postInvoice(reader,id,revision,"2026-06-01")).rejects.toThrow();
  await expect(postInvoice({ userId: W.userOwnerB, companyId: W.companyB },id,revision,"2026-06-01")).rejects.toThrow();
  expect(await Promise.all([postInvoice(actor,id,revision,"2026-06-01"),postInvoice(actor,id,revision,"2026-06-01")])).toEqual([id,id]);
  const invoice = (await getInvoice(reader,id))!;
  expect(invoice).toMatchObject({ status: "POSTED", number: "F-00001", totalCents: 11498n });
  expect((await listInvoices(reader)).some(i => i.id===id)).toBe(true);
  expect(await getDraft(actor,id)).toBeNull();
  await expect(deleteDraft(actor,id,revision)).rejects.toThrow();
  await expect(saveDraft(actor,{...input,revision},id)).rejects.toThrow();
  const lines = (await db.query("SELECT account_id,debit_cents::text,credit_cents::text,tax_box FROM journal_line WHERE entry_id=$1 ORDER BY line_no", [invoice.journalEntryId])).rows;
  expect(lines).toEqual([
    {account_id:W.receivable,debit_cents:'11498',credit_cents:'0',tax_box:null},
    {account_id:W.sales,debit_cents:'0',credit_cents:'10000',tax_box:null},
    ...[ [W.gstPayable,'500'],[W.qstPayable,'998'] ].map(([account_id,credit_cents])=>({account_id,debit_cents:'0',credit_cents,tax_box:'COLLECTED'})),
  ]);
  await db.query("UPDATE contact SET display_name='Changed',updated_at=now() WHERE id=$1",[W.customer]);
  expect((await getInvoice(reader,id))!.billingSnapshot).toEqual(invoice.billingSnapshot);
  expect((await db.query("SELECT count(*)::int AS n FROM journal_entry WHERE source_id=$1",[id])).rows[0].n).toBe(1);
});
it("refuses stale reviews and locked periods without consuming numbers", async () => {
  const id=await saveDraft(actor,input); const old=(await getDraft(actor,id))!;
  await saveDraft(actor,{...input,revision:old.revision,reference:'Revised'},id);
  await expect(postInvoice(actor,id,old.revision,'2026-06-01')).rejects.toThrow();
  const revision=(await getDraft(actor,id))!.revision;
  await expect(postInvoice(actor,id,revision,'2026-05-01')).rejects.toThrow();
  const numbers=(await db.query("SELECT key,next_value::text FROM number_sequence WHERE company_id=$1 ORDER BY key",[W.companyA])).rows;
  await db.query("UPDATE fiscal_period SET status='LOCKED',locked_at=now(),locked_by_id=$2 WHERE company_id=$1 AND period_number=6",[W.companyA,W.userOwnerA]);
  await expect(postInvoice(actor,id,revision,'2026-06-01')).rejects.toThrow();
  expect((await db.query("SELECT key,next_value::text FROM number_sequence WHERE company_id=$1 ORDER BY key",[W.companyA])).rows).toEqual(numbers);
  expect(await getDraft(actor,id)).not.toBeNull();
  await postInvoice(actor,id,revision,'2026-07-01');
  expect((await getInvoice(actor,id))!.number).toBe('F-00002');
});
