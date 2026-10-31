import { afterAll, beforeAll, expect, it } from "vitest";
import type pg from "pg";
import { getDraft, getDraftOptions, listDrafts, saveDraft, deleteDraft } from "@/modules/purchases";
import { owner } from "./helpers";
import { seedWorld, W } from "./world";
const actor = { userId: W.userOwnerA, companyId: W.companyA };
const reader = { ...actor, userId: W.userReader };
const accountant = { ...actor, userId: W.userAccountant };
const other = { userId: W.userOwnerB, companyId: W.companyB };
const line = { itemId: "", description: "Consultation", quantity: "1", unitPrice: "100", accountId: W.expenses, taxCodeId: W.taxCodeStandard };
const input = { contactId: W.supplier, documentDate: "2026-06-01", dueDate: "2026-07-01", supplierReference: "", lines: [line] };
const foreignContact = "00000000-0000-7000-8000-00000000c004";
let db: pg.Client;
beforeAll(async () => { db = await owner(); await seedWorld(db); await db.query("INSERT INTO contact (id,company_id,is_supplier,display_name,updated_at) VALUES ($1,$2,true,'Foreign customer',now())", [foreignContact, W.companyB]); });
afterAll(async () => { await db?.end(); });
it("saves exact taxes as a draft without posting, numbering, or mass assignment", async () => {
  const before = await db.query("SELECT count(*) AS n FROM journal_entry WHERE company_id=$1", [W.companyA]);
  const id = await saveDraft(accountant, { ...input, status: "POSTED", number: "FORGED", companyId: W.companyB, totalCents: 1 });
  const draft = await getDraft(reader, id);
  expect(draft).toMatchObject({ subtotalCents: 10000n, taxTotalCents: 1498n, totalCents: 11498n });
  const row = (await db.query("SELECT status,number,journal_entry_id FROM purchase_document d WHERE id=$1", [id])).rows[0];
  expect(row).toMatchObject({ status: "DRAFT", number: null, journal_entry_id: null });
  expect((await db.query("SELECT count(*) AS n FROM journal_entry WHERE company_id=$1", [W.companyA])).rows).toEqual(before.rows);
  expect((await listDrafts(reader)).drafts.some(d => d.id === id)).toBe(true);
  expect((await getDraftOptions(reader)).contacts.some(c => c.id === W.supplier)).toBe(true);
  await expect(saveDraft(reader, input)).rejects.toThrow();
  await expect(deleteDraft(reader, id, draft!.revision)).rejects.toThrow();
  expect(await getDraft(other, id)).toBeNull();
  expect((await listDrafts(other)).drafts).toHaveLength(0);
  await expect(saveDraft(other, { ...input, revision: draft!.revision }, id)).rejects.toThrow();
  await expect(deleteDraft(other, id, draft!.revision)).rejects.toThrow();
});
it("rejects foreign, inactive, missing-rate and malformed supplierReferences without partial documents", async () => {
  const before = (await listDrafts(actor)).drafts.length;
  for (const bad of [
    { ...input, contactId: foreignContact },
    { ...input, contactId: W.customer },
    { ...input, lines: [{ ...line, accountId: W.bankB }] },
    { ...input, lines: [{ ...line, accountId: W.sales }] },
    { ...input, lines: [{ ...line, taxCodeId: W.companyB }] },
    { ...input, documentDate: "1900-01-01" },
    { ...input, dueDate: "2020-01-01" },
    { ...input, lines: [{ ...line, quantity: "0.00001" }] },
    { ...input, lines: [{ ...line, unitPrice: "-1" }] },
    { ...input, lines: [{ ...line, quantity: "999999999999", unitPrice: "999999999999" }] },
  ]) await expect(saveDraft(actor, bad)).rejects.toThrow();
  await db.query("UPDATE contact SET is_active=false WHERE id=$1", [W.supplier]);
  await expect(saveDraft(actor, input)).rejects.toThrow();
  await db.query("UPDATE contact SET is_active=true WHERE id=$1", [W.supplier]);
  expect((await listDrafts(actor)).drafts).toHaveLength(before);
});
it("allows one concurrent edit, refuses stale deletion, and audits actual deletion", async () => {
  const id = await saveDraft(actor, input);
  const draft = (await getDraft(actor, id))!;
  const results = await Promise.allSettled(["First", "Second"].map(supplierReference => saveDraft(actor, { ...input, supplierReference, revision: draft.revision }, id)));
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  await expect(deleteDraft(actor, id, draft.revision)).rejects.toThrow();
  const latest = (await getDraft(actor, id))!;
  expect(latest.revision).not.toBe(draft.revision);
  await deleteDraft(actor, id, latest.revision);
  expect(await getDraft(actor, id)).toBeNull();
  expect((await db.query("SELECT action FROM audit_log WHERE entity_id=$1 ORDER BY occurred_at,id", [id])).rows.map(r => r.action)).toEqual(["row.insert", "row.update", "row.delete"]);
});
it("copies document rounding on creation and preserves it when defaults change", async () => {
  const small = { ...input, lines: [1, 2].map(() => ({ ...line, unitPrice: "0.05" })) };
  const perLine = await saveDraft(actor, small);
  await db.query("UPDATE company SET tax_rounding='PER_DOCUMENT' WHERE id=$1", [W.companyA]);
  const perDocument = await saveDraft(actor, small);
  expect((await getDraft(actor, perLine))?.totalCents).toBe(10n);
  expect((await getDraft(actor, perDocument))?.totalCents).toBe(12n);
  const original = (await getDraft(actor, perLine))!;
  await saveDraft(actor, { ...small, revision: original.revision }, perLine);
  expect((await getDraft(actor, perLine))?.taxRounding).toBe("PER_LINE");
  await db.query("UPDATE company SET tax_rounding='PER_LINE' WHERE id=$1", [W.companyA]);
});
it("rejects concurrent duplicate supplier references without partial rows", async () => {
  const duplicate = { ...input, supplierReference: "SUP-UNIQUE-1" };
  const results = await Promise.allSettled([saveDraft(actor, duplicate), saveDraft(actor, duplicate)]);
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(results.find(r => r.status === "rejected")).toMatchObject({ reason: { key: "purchases.duplicate" } });
  expect((await listDrafts(actor, "SUP-UNIQUE-1")).drafts).toHaveLength(1);
});
it("enforces modular accounting restrictions even for an accountant", async () => {
  await db.query("UPDATE membership SET module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2", [W.companyA, W.userAccountant, JSON.stringify({ accounting: "none" })]);
  await expect(getDraftOptions(accountant)).rejects.toThrow();
  await expect(saveDraft(accountant, input)).rejects.toThrow();
  await db.query("UPDATE membership SET module_access='{}' WHERE company_id=$1 AND user_id=$2", [W.companyA, W.userAccountant]);
});
