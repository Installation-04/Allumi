import { afterAll, beforeAll, expect, it } from "vitest";
import type pg from "pg";
import { saveDraft, getDraft, postBill, getBill, voidBill, saveCreditDraft, getCreditDraft, listCreditDrafts, deleteCreditDraft } from "@/modules/purchases";
import { owner } from "./helpers";
import { seedWorld, W } from "./world";
const actor = { userId: W.userOwnerA, companyId: W.companyA };
const reader = { ...actor, userId: W.userReader };
const other = { userId: W.userOwnerB, companyId: W.companyB };
let db: pg.Client;
let invoiceId: string;
let lineId: string;
const input = () => ({ documentDate: "2026-07-02", memo: "Partial correction", lines: [{ lineId, amount: "25.00" }] });
beforeAll(async () => {
  db = await owner(); await seedWorld(db);
  await db.query("INSERT INTO number_sequence(company_id,key,next_value,prefix,padding) VALUES ($1,'JOURNAL_ENTRY',1,'J-',5),($1,'PURCHASE_DOCUMENT',1,'F-',5)",[W.companyA]);
  invoiceId = await saveDraft(actor, { contactId: W.supplier, documentDate: "2026-06-01", dueDate: "2026-07-01", lines: [{ description: "Service", quantity: "2", unitPrice: "50", accountId: W.expenses, taxCodeId: W.taxCodeStandard }] });
  await postBill(actor, invoiceId, (await getDraft(actor,invoiceId))!.revision,"2026-06-01");
  lineId = (await getBill(actor, invoiceId))!.lines[0]!.id;
  // The draft must retain the original 5% GST even after the configured rate changes.
  await db.query("UPDATE tax_rate SET effective_to='2026-06-30' WHERE tax_id=$1",[W.gst]);
  await db.query("INSERT INTO tax_rate(id,company_id,tax_id,rate,effective_from) VALUES (gen_random_uuid(),$1,$2,0.06,'2026-07-01')",[W.companyA,W.gst]);
});
afterAll(async () => { await db?.end(); });
it("prepares a partial credit with original rates, references and rounding, without financial effects", async () => {
  const before=(await db.query("SELECT key,next_value::text FROM number_sequence WHERE company_id=$1 ORDER BY key",[W.companyA])).rows;
  const id=await saveCreditDraft(actor,invoiceId,input());
  const draft=(await getCreditDraft(reader,id))!;
  expect(draft).toMatchObject({kind:"SUPPLIER_CREDIT",status:"DRAFT",number:null,journalEntryId:null,creditedDocumentId:invoiceId,subtotalCents:2500n,taxTotalCents:374n,totalCents:2874n});
  expect(draft.lines[0]).toMatchObject({accountId:W.expenses,taxCodeId:W.taxCodeStandard,description:"Service",position:1,quantity:expect.anything(),amountCents:2500n});
  expect(draft.taxes.find(t=>t.taxId===W.gst)?.rate.toString()).toBe("0.05");
  expect((await listCreditDrafts(reader,invoiceId)).map(d=>d.id)).toContain(id);
  expect((await db.query("SELECT key,next_value::text FROM number_sequence WHERE company_id=$1 ORDER BY key",[W.companyA])).rows).toEqual(before);
  expect((await db.query("SELECT purchase_document_open_cents($1,$2)::text AS amount",[W.companyA,invoiceId])).rows[0].amount).toBe("11498");
  expect((await db.query("SELECT count(*)::int AS n FROM purchase_credit_application WHERE supplier_credit_id=$1",[id])).rows[0].n).toBe(0);
  expect((await db.query("SELECT count(*)::int AS n FROM audit_log WHERE entity_id=$1 AND action='row.insert'",[id])).rows[0].n).toBe(1);
});
it("rejects invalid amounts, lines, dates and cross-tenant/reader writes", async () => {
  await expect(saveCreditDraft(reader,invoiceId,input())).rejects.toThrow();
  await expect(saveCreditDraft(other,invoiceId,input())).rejects.toThrow();
  for(const amount of ["0","-1","100.01","1.001","NaN","1e2"]){
    await expect(saveCreditDraft(actor,invoiceId,{...input(),lines:[{lineId,amount}]})).rejects.toThrow();
  }
  await expect(saveCreditDraft(actor,invoiceId,{...input(),lines:[...input().lines,...input().lines]})).rejects.toThrow();
  await expect(saveCreditDraft(actor,invoiceId,{...input(),lines:[{lineId:W.expenses,amount:"1"}]})).rejects.toThrow();
  await expect(saveCreditDraft(actor,invoiceId,{...input(),memo:" "})).rejects.toThrow();
  await expect(saveCreditDraft(actor,invoiceId,{...input(),documentDate:"2026-05-01"})).rejects.toThrow();
  const id=await saveCreditDraft(actor,invoiceId,input());
  expect(await getCreditDraft(other,id)).toBeNull();
  expect(await listCreditDrafts(other)).toEqual([]);
  const draft=(await getCreditDraft(actor,id))!;
  await expect(deleteCreditDraft(reader,id,draft.revision)).rejects.toThrow();
  await expect(deleteCreditDraft(other,id,draft.revision)).rejects.toThrow();
  await expect(saveCreditDraft(reader,invoiceId,{...input(),revision:draft.revision},id)).rejects.toThrow();
});
it("rejects stale edits and deletes; only one concurrent edit wins", async () => {
  const id=await saveCreditDraft(actor,invoiceId,input());
  const original=(await getCreditDraft(actor,id))!;
  const results=await Promise.allSettled(["30,00","40.00"].map(amount=>saveCreditDraft(actor,invoiceId,{...input(),revision:original.revision,lines:[{lineId,amount}]},id)));
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);
  const draft=(await getCreditDraft(actor,id))!;
  expect([3000n,4000n]).toContain(draft.subtotalCents);
  await expect(deleteCreditDraft(actor,id,original.revision)).rejects.toThrow();
  await deleteCreditDraft(actor,id,draft.revision);
  expect(await getCreditDraft(actor,id)).toBeNull();
});
it("keeps a draft readable/deletable after the original invoice is voided, but refuses edits", async () => {
  const id=await saveCreditDraft(actor,invoiceId,input());
  const draft=(await getCreditDraft(actor,id))!;
  await voidBill(actor,invoiceId,"2026-07-03","Invoice replaced");
  expect((await getCreditDraft(reader,id))!.creditedDocument?.status).toBe("VOID");
  await expect(saveCreditDraft(actor,invoiceId,{...input(),revision:draft.revision},id)).rejects.toThrow();
  await expect(saveCreditDraft(actor,invoiceId,input())).rejects.toThrow();
  await deleteCreditDraft(actor,id,draft.revision);
});
