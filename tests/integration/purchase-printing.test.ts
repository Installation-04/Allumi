import { afterAll, beforeAll, expect, it } from "vitest";
import type pg from "pg";
import { getBill, getDraft, getCreditDraft, getPostedCredit, getPurchasePrintDocument, postBill, postCreditNote, saveDraft, saveCreditDraft, voidBill, voidCreditNote } from "@/modules/purchases";
import { getContact } from "@/modules/contacts";
import { owner } from "./helpers";
import { seedWorld, W } from "./world";
const actor = { userId: W.userOwnerA, companyId: W.companyA };
const reader = { ...actor, userId: W.userReader };
let db: pg.Client, billId: string, creditId: string, draftId: string;
beforeAll(async () => {
  db = await owner(); await seedWorld(db);
  await db.query("UPDATE contact SET display_name='Frozen supplier',address_line1='123 Snapshot Street',email='PRIVATE-ADDRESS@example.test' WHERE id=$1", [W.supplier]);
  await db.query("INSERT INTO number_sequence(company_id,key,next_value,prefix,padding) VALUES ($1,'JOURNAL_ENTRY',1,'J-',5),($1,'PURCHASE_DOCUMENT',1,'A-',5)", [W.companyA]);
  const input = { contactId: W.supplier, documentDate: "2026-06-01", dueDate: "2026-07-01", supplierReference: "SUPPLIER-REF", memo: "BILL-PRIVATE-NOTE", lines: [{ description: "Public supplies", quantity: "1.25", unitPrice: "80", accountId: W.expenses, taxCodeId: W.taxCodeStandard }] };
  billId = await saveDraft(actor, input); draftId = await saveDraft(actor, { ...input, supplierReference: "DRAFT-REF" });
  await postBill(actor, billId, (await getDraft(actor, billId))!.revision, "2026-06-01");
  const bill = (await getBill(actor, billId))!;
  creditId = await saveCreditDraft(actor, billId, { documentDate: "2026-06-02", memo: "CREDIT-PRIVATE-REASON", lines: [{ lineId: bill.lines[0]!.id, amount: "25" }] });
  await postCreditNote(actor, creditId, (await getCreditDraft(actor, creditId))!.revision, "2026-06-02");
});
afterAll(async () => { await db?.end(); });

it("projects exact posted figures and original identities without notes, private coordinates or technical references", async () => {
  const before = (await db.query("SELECT count(*)::int AS n FROM journal_entry")).rows[0].n;
  const bill = (await getPurchasePrintDocument(reader, billId, "BILL"))!;
  expect(bill).toMatchObject({ number: "A-00001", date: "2026-06-01", dueDate: "2026-07-01", reference: "SUPPLIER-REF", subtotalCents: 10000n, totalCents: 11498n });
  expect(bill.supplier).toContain("Frozen supplier"); expect(bill.supplier).toContain("123 Snapshot Street");
  expect(bill.lines[0]).toMatchObject({ quantity: "1.25", unitPrice: "80", amountCents: 10000n });
  expect(bill.taxes.reduce((sum,row) => sum+row.amountCents,0n)).toBe(1498n);
  const credit = (await getPurchasePrintDocument(reader, creditId, "SUPPLIER_CREDIT"))!;
  expect(credit).toMatchObject({ sourceNumber: "A-00001", subtotalCents: 2500n, totalCents: 2874n });
  const text = JSON.stringify([bill,credit], (_,value) => typeof value === "bigint" ? value.toString() : value);
  for (const privateValue of ["BILL-PRIVATE-NOTE", "CREDIT-PRIVATE-REASON", "PRIVATE-ADDRESS", "journalEntryId", "contactId", "supplierSnapshot", "voidReason", "taxId"]) expect(text).not.toContain(privateValue);
  expect((await db.query("SELECT count(*)::int AS n FROM journal_entry")).rows[0].n).toBe(before);
});

it("supports Accounting without Contacts, Sales or Taxes and retains readable detail pages", async () => {
  await db.query("UPDATE contact SET display_name='Changed private supplier',address_line1='Changed address' WHERE id=$1", [W.supplier]);
  await db.query("UPDATE membership SET module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2", [W.companyA, W.userReader, JSON.stringify({ accounting: "read", contacts: "none", sales: "none", taxes: "none" })]);
  await expect(getContact(reader, W.supplier)).rejects.toThrow();
  for (const [id,kind] of [[billId,"BILL"],[creditId,"SUPPLIER_CREDIT"]] as const) {
    const document = (await getPurchasePrintDocument(reader,id,kind))!;
    expect(document.supplier).toContain("Frozen supplier"); expect(document.supplier).not.toContain("Changed private supplier");
    expect(document.taxes).toHaveLength(2); expect(document.taxes.every(row => row.code === null)).toBe(true);
  }
  expect((await getBill(reader,billId))?.taxes.every(row => row.tax === null)).toBe(true);
  expect((await getPostedCredit(reader,creditId))?.taxes.every(row => row.tax === null)).toBe(true);
});

it("rejects drafts, wrong kinds, other companies and accounting denial", async () => {
  expect(await getPurchasePrintDocument(reader,draftId,"BILL")).toBeNull();
  expect(await getPurchasePrintDocument(reader,billId,"SUPPLIER_CREDIT")).toBeNull();
  const other = { userId: W.userOwnerB, companyId: W.companyB };
  expect(await getPurchasePrintDocument(other,billId,"BILL")).toBeNull();
  expect(await getPurchasePrintDocument(other,creditId,"SUPPLIER_CREDIT")).toBeNull();
  await db.query("UPDATE membership SET module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2", [W.companyA,W.userReader,JSON.stringify({ accounting:"none" })]);
  await expect(getPurchasePrintDocument(reader,billId,"BILL")).rejects.toMatchObject({ key:"forbidden" });
  await expect(getPurchasePrintDocument(reader,creditId,"SUPPLIER_CREDIT")).rejects.toMatchObject({ key:"forbidden" });
});

it("marks voided copies with their reversal date without exposing private reversal reasons or replacing original figures", async () => {
  await voidCreditNote(actor,creditId,"2026-06-03","PRIVATE-REVERSAL-CREDIT");
  await voidBill(actor,billId,"2026-06-04","PRIVATE-REVERSAL-BILL");
  const credit = (await getPurchasePrintDocument(actor,creditId,"SUPPLIER_CREDIT"))!;
  const bill = (await getPurchasePrintDocument(actor,billId,"BILL"))!;
  expect(credit).toMatchObject({ status:"VOID",voidDate:"2026-06-03",totalCents:2874n });
  expect(bill).toMatchObject({ status:"VOID",voidDate:"2026-06-04",totalCents:11498n });
  expect(JSON.stringify([bill,credit],(_,v) => typeof v === "bigint" ? v.toString() : v)).not.toContain("PRIVATE");
});
