import { afterAll, beforeAll, expect, it } from "vitest";
import type pg from "pg";
import { getSupplierRefundPrintDocument, listSupplierRefundOrigins, recordSupplierRefund, voidSupplierRefund, recordDisbursement } from "@/modules/payments";
import { saveDraft, getDraft, getBill, postBill, saveCreditDraft, getCreditDraft, postCreditNote } from "@/modules/purchases";
import { getContact } from "@/modules/contacts";
import { owner } from "./helpers";
import { seedWorld, W } from "./world";
const actor = { userId: W.userOwnerA, companyId: W.companyA }, reader = { ...actor, userId: W.userReader };
let db: pg.Client, refundId: string, creditId: string, disbursementId: string;
beforeAll(async () => {
  db = await owner(); await seedWorld(db);
  await db.query("UPDATE contact SET display_name='Original supplier',email='PRIVATE-EMAIL@example.test' WHERE id=$1", [W.supplier]);
  await db.query("INSERT INTO number_sequence(company_id,key,next_value,prefix,padding) VALUES($1,'JOURNAL_ENTRY',1,'J-',5),($1,'PURCHASE_DOCUMENT',1,'A-',5),($1,'PAYMENT_SENT',1,'D-',5),($1,'PAYMENT_RECEIVED',1,'E-',5)", [W.companyA]);
  const billId = await saveDraft(actor, { contactId: W.supplier, documentDate: "2026-06-01", dueDate: "2026-07-01", lines: [{ description: "Supplies", quantity: "1", unitPrice: "100", accountId: W.expenses, taxCodeId: W.taxCodeStandard }] });
  await postBill(actor, billId, (await getDraft(actor, billId))!.revision, "2026-06-01");
  disbursementId = (await recordDisbursement(actor, { billId, amountCents: "11498", expectedOpenCents: "11498", date: "2026-06-02", accountId: W.bank, method: "EFT" })).id;
  const bill = (await getBill(actor, billId))!;
  creditId = await saveCreditDraft(actor, billId, { documentDate: "2026-06-03", memo: "PRIVATE-CREDIT", lines: [{ lineId: bill.lines[0]!.id, amount: "100" }] });
  await postCreditNote(actor, creditId, (await getCreditDraft(actor, creditId))!.revision, "2026-06-03", { applicationMode: "UNAPPLIED" });
  refundId = (await recordSupplierRefund(actor, { supplierCreditId: creditId, amountCents: "2874", expectedOpenCents: "11498", date: "2026-06-04", accountId: W.bank, method: "EFT", reference: "PUBLIC-REFERENCE", memo: "PRIVATE-REFUND" })).id;
});
afterAll(async () => { await db?.end(); });

it("prints an explicit public-field projection with exact original figures and no financial writes", async () => {
  const before = (await db.query("SELECT count(*)::int AS n FROM journal_entry")).rows[0].n;
  const document = (await getSupplierRefundPrintDocument(reader, refundId))!;
  expect(document).toEqual({ number: "E-00001", date: "2026-06-04", amountCents: 2874n, status: "POSTED", method: "EFT", reference: "PUBLIC-REFERENCE", supplier: "Original supplier", voidDate: null, origins: [{ number: "A-00002", amountCents: 2874n, appliedDate: "2026-06-04", unappliedDate: null }] });
  const text = JSON.stringify(document, (_, v) => typeof v === "bigint" ? v.toString() : v);
  for (const secret of ["PRIVATE", "contactId", "accountId", "journalEntryId", "supplierSnapshot", "voidReason", "createdById", refundId, creditId]) expect(text).not.toContain(secret);
  expect((await db.query("SELECT count(*)::int AS n FROM journal_entry")).rows[0].n).toBe(before);
});

it("keeps the frozen supplier readable without Contacts, Sales or Taxes and rejects accounting denial and foreign/wrong-kind documents", async () => {
  await db.query("UPDATE contact SET display_name='Changed private identity' WHERE id=$1", [W.supplier]);
  await db.query("UPDATE membership SET module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2", [W.companyA, W.userReader, JSON.stringify({ accounting: "read", contacts: "none", sales: "none", taxes: "none" })]);
  await expect(getContact(reader, W.supplier)).rejects.toThrow();
  expect((await getSupplierRefundPrintDocument(reader, refundId))?.supplier).toBe("Original supplier");
  expect(await getSupplierRefundPrintDocument({ userId: W.userOwnerB, companyId: W.companyB }, refundId)).toBeNull();
  expect(await getSupplierRefundPrintDocument(reader, disbursementId)).toBeNull();
  expect(await getSupplierRefundPrintDocument(reader, "00000000-0000-7000-8000-999999999999")).toBeNull();
  await db.query("UPDATE membership SET module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2", [W.companyA, W.userReader, JSON.stringify({ accounting: "none" })]);
  await expect(getSupplierRefundPrintDocument(reader, refundId)).rejects.toMatchObject({ key: "forbidden" });
  await db.query("UPDATE membership SET module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2", [W.companyA, W.userReader, JSON.stringify({ accounting: "read", contacts: "none", sales: "none", taxes: "none" })]);
});

it("includes all historical origins beyond one detail page, or refuses explicitly at its limit", async () => {
  // Replay active application/release pairs through the real guards, preserving every historical row.
  await db.query("UPDATE payment_allocation SET unapplied_date='2026-06-04',unapplied_by_id=$3 WHERE company_id=$1 AND payment_id=$2 AND unapplied_date IS NULL", [W.companyA, refundId, W.userOwnerA]);
  for (let i = 0; i < 26; i++) {
    const row = (await db.query("INSERT INTO payment_allocation(id,company_id,payment_id,purchase_document_id,amount_cents,applied_date,created_by_id) VALUES(gen_random_uuid(),$1,$2,$3,$4,'2026-06-04',$5) RETURNING id", [W.companyA, refundId, creditId, i === 25 ? 2874 : 1, W.userOwnerA])).rows[0];
    if (i < 25) await db.query("UPDATE payment_allocation SET unapplied_date='2026-06-04',unapplied_by_id=$2 WHERE id=$1", [row.id, W.userOwnerA]);
  }
  const document = (await getSupplierRefundPrintDocument(reader, refundId))!;
  expect(document.origins).toHaveLength(27); expect(document.origins.filter(row => row.unappliedDate)).toHaveLength(26);
  const first = await listSupplierRefundOrigins(reader, refundId), second = await listSupplierRefundOrigins(reader, refundId, 2);
  expect(first.origins).toHaveLength(25); expect(second.origins).toHaveLength(2);
  const project = (row: (typeof first.origins)[number]) => ({ number: row.number, amountCents: row.amountCents, appliedDate: "2026-06-04", unappliedDate: row.unappliedDate });
  expect(document.origins).toEqual([...first.origins, ...second.origins].reverse().map(project));
  await expect(getSupplierRefundPrintDocument(reader, refundId, { maxOrigins: 26 })).rejects.toMatchObject({ key: "supplierRefunds.printLimit" });
  expect((await getSupplierRefundPrintDocument(reader, refundId, { maxOrigins: 27 }))?.origins).toHaveLength(27);
  for (const maxOrigins of [-1, 0.5, 1001, NaN, Infinity]) await expect(getSupplierRefundPrintDocument(reader, refundId, { maxOrigins })).rejects.toMatchObject({ key: "payments.invalidFilters" });
});

it("retains the original amount and date with dated reversal and releases, excluding the private reason", async () => {
  await voidSupplierRefund(actor, refundId, { date: "2026-06-05", reason: "PRIVATE-REVERSAL" });
  const document = (await getSupplierRefundPrintDocument(reader, refundId))!;
  expect(document).toMatchObject({ status: "VOID", voidDate: "2026-06-05", date: "2026-06-04", amountCents: 2874n });
  expect(document.origins.filter(row => row.unappliedDate === "2026-06-05")).toHaveLength(1);
  expect(document.origins.filter(row => row.unappliedDate === "2026-06-04")).toHaveLength(26);
  expect(JSON.stringify(document, (_, v) => typeof v === "bigint" ? v.toString() : v)).not.toContain("PRIVATE");
});
