import { afterAll, beforeAll, expect, it } from "vitest";
import type pg from "pg";
import { saveEstimate, getEstimate, listEstimates, transitionEstimate, convertEstimate, deleteEstimate, getDraft, saveDraft, deleteDraft, postInvoice, getInvoice, listDrafts } from "@/modules/sales";
import { searchCompany } from "@/modules/search";
import { todayIso } from "@/modules/ledger";
import { owner } from "./helpers";
import { appClient, inContext, seedWorld, W } from "./world";
const actor = { userId: W.userOwnerA, companyId: W.companyA };
const reader = { ...actor, userId: W.userReader };
const writer = { ...actor, userId: W.userAccountant };
const other = { userId: W.userOwnerB, companyId: W.companyB };
const line = { itemId: "", description: "Consultation", quantity: "1", unitPrice: "100", accountId: W.sales, taxCodeId: W.taxCodeStandard };
const input = { contactId: W.customer, issueDate: "2026-06-01", dueDate: "2999-01-01", reference: "DEV test", terms: "Net 30", memo: "Privé", lines: [line] };
let db: pg.Client;
let app: pg.Client;
beforeAll(async () => { db = await owner(); await seedWorld(db); await db.query("UPDATE account SET system_key='ACCOUNTS_RECEIVABLE' WHERE id=$1", [W.receivable]); await db.query("INSERT INTO number_sequence(company_id,key,prefix,padding,next_value) VALUES($1,'INVOICE','FAC-',5,1),($1,'JOURNAL_ENTRY','J-',5,1)", [W.companyA]); app = await appClient(); });
afterAll(async () => { await app?.end(); await db?.end(); });
async function sent() { const id = await saveEstimate(actor, input); const d = (await getEstimate(actor, id))!; await transitionEstimate(actor, id, d.revision, "SENT"); return (await getEstimate(actor, id))!; }
async function accepted() { const d = await sent(); await transitionEstimate(actor, d.id, d.revision, "ACCEPTED", "Accord reçu par téléphone"); return (await getEstimate(actor, d.id))!; }
it("stores exact draft taxes, ignores mass assignment, isolates tenants and audits without accounting entries", async () => {
  const before = (await db.query("SELECT count(*) AS n FROM journal_entry")).rows;
  const id = await saveEstimate(actor, { ...input, companyId: W.companyB, status: "CONVERTED", totalCents: 1, number: "FAKE" });
  const quote = (await getEstimate(reader, id))!;
  expect(quote).toMatchObject({ status: "DRAFT", number: null, totalCents: 11498n, taxTotalCents: 1498n, terms: "Net 30" });
  expect((await db.query("SELECT count(*) AS n FROM journal_entry")).rows).toEqual(before);
  expect(await getEstimate(other, id)).toBeNull();
  expect((await listEstimates(other)).estimates).toHaveLength(0);
  await expect(listEstimates(reader, { q: "\u0000" })).rejects.toThrow("estimates.invalid");
  for (const forbidden of [reader, other]) {
    await expect(saveEstimate(forbidden, input)).rejects.toThrow();
    await expect(transitionEstimate(forbidden, id, quote.revision, "SENT")).rejects.toThrow();
    await expect(deleteEstimate(forbidden, id, quote.revision)).rejects.toThrow();
  }
  expect((await db.query("SELECT action FROM audit_log WHERE entity_id=$1", [id])).rows.map(r => r.action)).toEqual(["row.insert"]);
  await deleteEstimate(actor, id, quote.revision);
  expect(await getEstimate(actor, id)).toBeNull();
});
it("numbers manual delivery once, freezes identities and rejects issued edits and forged database mutations", async () => {
  const quote = await sent();
  for (const q of ["%", "_", "\\"]) expect((await listEstimates(reader, { q })).estimates).toHaveLength(0);
  expect(quote.number).toMatch(/^DEV-\d{5}$/);
  expect(quote.customerSnapshot?.name).toBeTruthy();
  const oldName = quote.customer;
  await db.query("UPDATE contact SET display_name='Changed' WHERE id=$1", [W.customer]);
  expect((await getEstimate(reader, quote.id))?.customer).toBe(oldName);
  await expect(saveEstimate(actor, { ...input, revision: quote.revision }, quote.id)).rejects.toThrow("estimates.immutable");
  await expect(deleteEstimate(actor, quote.id, quote.revision)).rejects.toThrow();
  await expect(transitionEstimate(actor, quote.id, quote.revision, "SENT")).rejects.toThrow();
  for (const sql of ["UPDATE sales_estimate SET terms='forged' WHERE id=$1", "UPDATE sales_estimate SET responded_at=now() WHERE id=$1", "UPDATE sales_estimate_line SET description='forged' WHERE estimate_id=$1", "DELETE FROM sales_estimate WHERE id=$1"]) {
    await expect(inContext(app, actor, () => app.query(sql, [quote.id]))).rejects.toMatchObject({ code: "AL006" });
  }
});
it("permits only one concurrent draft edit and protects stale revisions", async () => {
  const id = await saveEstimate(actor, input);
  const d = (await getEstimate(actor, id))!;
  const edits = await Promise.allSettled(["One", "Two"].map(reference => saveEstimate(actor, { ...input, reference, revision: d.revision }, id)));
  expect(edits.filter(e => e.status === "fulfilled")).toHaveLength(1);
  await expect(transitionEstimate(actor, id, d.revision, "SENT")).rejects.toThrow("estimates.stale");
  await expect(deleteEstimate(actor, id, d.revision)).rejects.toThrow("estimates.stale");
});
it("rejects malformed, foreign, future, expired and inactive inputs without partial documents", async () => {
  for (const bad of [{ ...input, contactId: W.supplier }, { ...input, issueDate: "2999-01-01" }, { ...input, dueDate: "2020-01-01" }, { ...input, terms: "x".repeat(4001) }, { ...input, lines: [{ ...line, accountId: W.bankB }] }]) await expect(saveEstimate(actor, bad)).rejects.toThrow();
  const id = await saveEstimate(actor, { ...input, dueDate: "2026-06-02" });
  await expect(transitionEstimate(actor, id, (await getEstimate(actor, id))!.revision, "SENT")).rejects.toThrow("estimates.transition");
  const draftId = await saveEstimate(actor, input);
  await db.query("UPDATE contact SET is_active=false WHERE id=$1", [W.customer]);
  await expect(transitionEstimate(actor, draftId, (await getEstimate(actor, draftId))!.revision, "SENT")).rejects.toThrow();
  await db.query("UPDATE contact SET is_active=true WHERE id=$1", [W.customer]);
});
it("converts once under concurrency into a reviewed draft, keeps customer and releases a deleted draft", async () => {
  const q = await accepted();
  const before = (await db.query("SELECT count(*) AS n FROM journal_entry")).rows;
  const [id, retry] = await Promise.all([1, 2].map(() => convertEstimate(actor, q.id, q.revision, "2026-06-15", "2026-07-15")));
  expect(retry).toBe(id);
  const draft = (await getDraft(actor, id!))!;
  expect(draft.totalCents).toBe(q.totalCents);
  expect(draft.memo).toBe("");
  expect((await getEstimate(actor, q.id))?.memo).toBe("Privé");
  expect((await getEstimate(reader, q.id))?.convertedInvoiceId).toBe(id);
  expect((await db.query("SELECT count(*) AS n FROM journal_entry")).rows).toEqual(before);
  await expect(saveDraft(actor, { ...input, contactId: W.otherCustomer, revision: draft.revision }, id)).rejects.toThrow("estimates.customerLocked");
  await expect(inContext(app, actor, () => app.query("UPDATE sales_document SET contact_id=$2 WHERE id=$1", [id, W.otherCustomer]))).rejects.toMatchObject({ code: "AL004" });
  await expect(inContext(app, actor, () => app.query("UPDATE sales_estimate SET status='ACCEPTED',converted_invoice_id=NULL,converted_at=NULL WHERE id=$1", [q.id]))).rejects.toMatchObject({ code: "AL004" });
  await deleteDraft(actor, id!, draft.revision);
  const released = (await getEstimate(actor, q.id))!;
  expect(released).toMatchObject({ status: "ACCEPTED", convertedInvoiceId: null });
  await expect(convertEstimate(actor, q.id, q.revision, "2026-06-15", "2026-07-15")).rejects.toThrow("estimates.stale");
  const replacement = await convertEstimate(actor, q.id, released.revision, "2026-06-15", "2026-07-15");
  expect(replacement).not.toBe(id);
  await postInvoice(actor, replacement, (await getDraft(actor, replacement))!.revision, "2026-06-15");
  expect((await db.query("SELECT status,journal_entry_id FROM sales_document WHERE id=$1", [replacement])).rows[0]).toMatchObject({ status: "POSTED", journal_entry_id: expect.any(String) });
});
it("supports decline and cancellation but refuses conversion without acceptance", async () => {
  const q = await sent();
  await expect(convertEstimate(actor, q.id, q.revision, todayIso(), todayIso())).rejects.toThrow("estimates.transition");
  await transitionEstimate(actor, q.id, q.revision, "DECLINED", "Budget");
  const declined = (await getEstimate(actor, q.id))!;
  await expect(transitionEstimate(actor, q.id, declined.revision, "ACCEPTED")).rejects.toThrow();
  const cancel = await accepted();
  await transitionEstimate(actor, cancel.id, cancel.revision, "CANCELLED");
  expect((await listEstimates(reader, { status: "CANCELLED" })).estimates.some(e => e.id === cancel.id)).toBe(true);
  const result = await searchCompany(reader, { type: "ESTIMATE", statut: "CANCELLED", q: cancel.number! }, "en");
  expect(result.rows).toEqual([expect.objectContaining({ id: cancel.id, href: `/c/${actor.companyId}/devis/${cancel.id}`, status: "CANCELLED", amountCents: 11498n })]);
});
it("uses Sales module rights without requiring Accounting write, hides drafts' contacts and preserves issued snapshots", async () => {
  const q = await sent();
  await db.query("UPDATE membership SET module_access=$1::jsonb WHERE company_id=$2 AND user_id=$3", [JSON.stringify({ sales: "write", accounting: "read", contacts: "read", taxes: "read" }), W.companyA, W.userAccountant]);
  const id = await saveEstimate(writer, input);
  await transitionEstimate(writer, id, (await getEstimate(writer, id))!.revision, "SENT");
  await db.query("UPDATE membership SET module_access=$1::jsonb WHERE company_id=$2 AND user_id=$3", [JSON.stringify({ sales: "read", accounting: "none", contacts: "none", taxes: "none" }), W.companyA, W.userAccountant]);
  expect((await getEstimate(writer, q.id))?.customer).toBe(q.customer);
  const draftId = await saveDraft(actor, input);
  const readDraft = (await getDraft(writer, draftId))!;
  expect(readDraft.customer).toBe("");
  expect(readDraft.taxes.every(t => t.code === "")).toBe(true);
  expect((await listDrafts(writer)).drafts.find(d => d.id === draftId)?.customer).toBe("");
  await postInvoice(actor, draftId, readDraft.revision, "2026-06-15");
  expect((await getInvoice(writer, draftId))?.taxes.every(t => t.tax.code === "")).toBe(true);
  expect((await listEstimates(writer)).estimates.some(e => e.id === q.id)).toBe(true);
  await expect(saveEstimate(writer, input)).rejects.toThrow("forbidden");
  await db.query("UPDATE membership SET module_access='{}'::jsonb WHERE company_id=$1 AND user_id=$2", [W.companyA, W.userAccountant]);
});
it("recalculates invoice-date rates while retaining the estimate's rounding after defaults change", async () => {
  const quote = await accepted();
  await db.query("UPDATE company SET tax_rounding='PER_DOCUMENT' WHERE id=$1", [W.companyA]);
  await db.query("UPDATE tax_rate SET effective_to='2026-06-30' WHERE company_id=$1 AND tax_id=$2", [W.companyA, W.gst]);
  await db.query("INSERT INTO tax_rate(id,company_id,tax_id,effective_from,rate) VALUES(gen_random_uuid(),$1,$2,'2026-07-01',0.06)", [W.companyA, W.gst]);
  const invoiceId = await convertEstimate(actor, quote.id, quote.revision, "2026-07-01", "2026-07-31");
  expect((await getDraft(actor, invoiceId))).toMatchObject({ taxRounding: "PER_LINE", totalCents: 11598n });
  expect((await getEstimate(actor, quote.id))?.totalCents).toBe(11498n);
  await db.query("DELETE FROM tax_rate WHERE company_id=$1 AND tax_id=$2 AND effective_from='2026-07-01'", [W.companyA, W.gst]);
  await db.query("UPDATE tax_rate SET effective_to=NULL WHERE company_id=$1 AND tax_id=$2", [W.companyA, W.gst]);
  await db.query("UPDATE company SET tax_rounding='PER_LINE' WHERE id=$1", [W.companyA]);
});
it("refuses forged draft totals, direct transitions, counter rewinds and inaccessible contact searches", async () => {
  const id = await saveEstimate(actor, input);
  await expect(inContext(app, actor, () => app.query("UPDATE sales_estimate SET subtotal_cents=1,total_cents=1+tax_total_cents WHERE id=$1", [id]))).rejects.toMatchObject({ code: "AL004" });
  await expect(inContext(app, actor, () => app.query("UPDATE sales_estimate SET status='ACCEPTED',responded_at=now() WHERE id=$1", [id]))).rejects.toMatchObject({ code: "AL006" });
  await expect(inContext(app, actor, () => app.query("UPDATE sales_estimate_counter SET next_value=1 WHERE company_id=$1", [W.companyA]))).rejects.toMatchObject({ code: "AL009" });
  await db.query("UPDATE membership SET module_access='{\"contacts\":\"none\"}'::jsonb WHERE company_id=$1 AND user_id=$2", [W.companyA, W.userReader]);
  expect((await getEstimate(reader, id))?.customer).toBeNull();
  expect((await listEstimates(reader, { q: "Changed", status: "DRAFT" })).estimates).toHaveLength(0);
  await db.query("UPDATE membership SET module_access='{}'::jsonb WHERE company_id=$1 AND user_id=$2", [W.companyA, W.userReader]);
});
