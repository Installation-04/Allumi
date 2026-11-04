import { afterAll, beforeAll, expect, it } from "vitest";
import type pg from "pg";
import {
  applyCustomerCredit, unapplyCustomerCredit, listCreditApplicationTargets, listCreditApplications,
  getDraft, getInvoice, getInvoiceOpenCents, getCreditDraft, getCreditOpenCents, postCreditNote, postInvoice, saveCreditDraft, saveDraft,
} from "@/modules/sales";
import { recordReceipt, voidReceipt, getReceipt, recordCustomerRefund, voidCustomerRefund, getCustomerRefund } from "@/modules/payments";
import { owner } from "./helpers";
import { seedWorld, W } from "./world";

const actor = { userId: W.userOwnerA, companyId: W.companyA };
const reader = { ...actor, userId: W.userReader };
const accountant = { ...actor, userId: W.userAccountant };
const other = { userId: W.userOwnerB, companyId: W.companyB };
const now = new Date("2026-12-31T12:00:00Z");
const total = 11498n;
let db: pg.Client;
beforeAll(async () => {
  db = await owner();
  await seedWorld(db);
  await db.query("INSERT INTO number_sequence(company_id,key,next_value,prefix,padding) VALUES ($1,'JOURNAL_ENTRY',1,'J-',5),($1,'INVOICE',1,'F-',5),($1,'CREDIT_NOTE',1,'AV-',5),($1,'PAYMENT_RECEIVED',1,'E-',5),($1,'PAYMENT_SENT',1,'R-',5)", [W.companyA]);
});
afterAll(async () => { await db?.end(); });

async function invoice(contactId: string = W.customer, reference = "") {
  const id = await saveDraft(actor, { contactId, issueDate: "2026-06-01", dueDate: "2026-07-01", reference, lines: [{ description: "Service", quantity: "1", unitPrice: "100", accountId: W.sales, taxCodeId: W.taxCodeStandard }] });
  await postInvoice(actor, id, (await getDraft(actor, id))!.revision, "2026-06-01");
  return id;
}
async function credit() {
  const sourceId = await invoice();
  await recordReceipt(actor, { invoiceId: sourceId, amountCents: String(total), expectedOpenCents: String(total), date: "2026-06-02", accountId: W.bank, method: "EFT" }, { now });
  const source = (await getInvoice(actor, sourceId))!;
  const id = await saveCreditDraft(actor, sourceId, { issueDate: "2026-06-05", memo: "Returned service", lines: [{ lineId: source.lines[0]!.id, amount: "100" }] });
  await postCreditNote(actor, id, (await getCreditDraft(actor, id))!.revision, "2026-06-05", { applicationMode: "UNAPPLIED" });
  return id;
}
const input = (creditNoteId: string, invoiceId: string, over: Record<string, unknown> = {}) => ({ creditNoteId, invoiceId, amountCents: "5000", expectedCreditCents: String(total), expectedInvoiceCents: String(total), date: "2026-06-10", ...over });
const entries = async () => Number((await db.query("SELECT count(*) AS n FROM journal_entry WHERE company_id=$1", [W.companyA])).rows[0].n);

it("applies a partial available credit without posting another journal and preserves a dated release", async () => {
  const creditNoteId = await credit();
  const invoiceId = await invoice();
  const before = await entries();
  const { id } = await applyCustomerCredit(actor, input(creditNoteId, invoiceId), { now });
  expect(await entries()).toBe(before);
  expect(await getCreditOpenCents(actor, creditNoteId)).toBe(total - 5000n);
  expect(await getInvoiceOpenCents(actor, invoiceId)).toBe(total - 5000n);
  expect((await listCreditApplications(reader, creditNoteId)).applications).toEqual([expect.objectContaining({ id, invoiceId, amountCents: 5000n, appliedDate: "2026-06-10", unappliedDate: null })]);
  expect((await listCreditApplicationTargets(actor, creditNoteId)).invoices.map(row => row.id)).not.toContain(invoiceId);
  await expect(applyCustomerCredit(actor, input(creditNoteId, invoiceId, { expectedCreditCents: "6498", expectedInvoiceCents: "6498", amountCents: "1" }), { now })).rejects.toMatchObject({ key: "salesApplications.alreadyApplied" });
  expect(await unapplyCustomerCredit(actor, id, { date: "2026-06-15" }, { now })).toBe(id);
  expect(await unapplyCustomerCredit(actor, id, { date: "2026-06-20" }, { now })).toBe(id);
  expect(await entries()).toBe(before);
  expect(await getCreditOpenCents(actor, creditNoteId)).toBe(total);
  expect(await getInvoiceOpenCents(actor, invoiceId)).toBe(total);
  expect((await listCreditApplications(actor, creditNoteId)).applications[0]).toMatchObject({ id, unappliedDate: "2026-06-15" });
  const reapplied = await applyCustomerCredit(actor, input(creditNoteId, invoiceId, { date: "2026-06-15" }), { now });
  expect(reapplied.id).not.toBe(id);
  expect((await listCreditApplications(actor, creditNoteId)).total).toBe(2);
  const events = (await db.query("SELECT action FROM audit_log WHERE company_id=$1 AND entity_type='sales_credit_application' AND entity_id=$2 ORDER BY occurred_at,id", [W.companyA, id])).rows;
  expect(events.map(row => row.action)).toEqual(["row.insert", "row.update"]);
});

it("rejects invalid, stale, excessive and historically unavailable amounts without creating links", async () => {
  const creditNoteId = await credit();
  const invoiceId = await invoice();
  for (const [over, key] of [
    [{ amountCents: "0" }, "invalid"], [{ amountCents: "1.5" }, "invalid"], [{ amountCents: "-1" }, "invalid"],
    [{ expectedCreditCents: "0" }, "stale"], [{ expectedInvoiceCents: "0" }, "stale"],
    [{ amountCents: String(total + 1n) }, "exceeds"], [{ date: "2026-02-30" }, "invalid"],
    [{ date: "2027-01-01" }, "futureDate"], [{ date: "2026-06-04" }, "dateBeforeDocuments"],
  ] as const) await expect(applyCustomerCredit(actor, input(creditNoteId, invoiceId, over), { now })).rejects.toMatchObject({ key: `salesApplications.${key}` });
  const { id } = await applyCustomerCredit(actor, input(creditNoteId, invoiceId), { now });
  await expect(unapplyCustomerCredit(actor, id, { date: "2026-06-09" }, { now })).rejects.toMatchObject({ key: "salesApplications.dateBeforeDocuments" });
  await unapplyCustomerCredit(actor, id, { date: "2026-06-20" }, { now });
  await expect(applyCustomerCredit(actor, input(creditNoteId, invoiceId, { date: "2026-06-19" }), { now })).rejects.toMatchObject({ key: "salesApplications.dateBeforeMovement" });
  await expect(unapplyCustomerCredit(actor, id, { date: "2026-06-20", reason: "not persisted" }, { now })).rejects.toMatchObject({ key: "salesApplications.invalid" });
  expect((await listCreditApplications(actor, creditNoteId)).total).toBe(1);
});

it("checks movements of the target invoice as well as the credit", async () => {
  const creditNoteId = await credit();
  const invoiceId = await invoice();
  await recordReceipt(actor, { invoiceId, amountCents: "1000", expectedOpenCents: String(total), date: "2026-06-20", accountId: W.bank, method: "EFT" }, { now });
  await expect(applyCustomerCredit(actor, input(creditNoteId, invoiceId, { expectedInvoiceCents: "10498", date: "2026-06-19" }), { now })).rejects.toMatchObject({ key: "salesApplications.dateBeforeMovement" });
  await applyCustomerCredit(actor, input(creditNoteId, invoiceId, { expectedInvoiceCents: "10498", date: "2026-06-20" }), { now });
});

it("explains historical receipt and refund refusals before any payment or reversal is posted", async () => {
  const creditNoteId = await credit();
  const invoiceId = await invoice();
  const { id } = await applyCustomerCredit(actor, input(creditNoteId, invoiceId), { now });
  await unapplyCustomerCredit(actor, id, { date: "2026-06-20" }, { now });
  const beforeReceipt = await entries();
  await expect(recordReceipt(actor, { invoiceId, amountCents: "1000", expectedOpenCents: String(total), date: "2026-06-15", accountId: W.bank, method: "EFT" }, { now })).rejects.toMatchObject({ key: "payments.dateBeforeMovement" });
  expect(await entries()).toBe(beforeReceipt);
  expect(await getInvoiceOpenCents(actor, invoiceId)).toBe(total);
  const receipt = await recordReceipt(actor, { invoiceId, amountCents: "1000", expectedOpenCents: String(total), date: "2026-06-20", accountId: W.bank, method: "EFT" }, { now });
  await applyCustomerCredit(actor, input(creditNoteId, invoiceId, { amountCents: "1000", expectedInvoiceCents: "10498", date: "2026-06-25" }), { now });
  const beforeReceiptVoid = await entries();
  await expect(voidReceipt(actor, receipt.id, { date: "2026-06-21", reason: "Before later credit" })).rejects.toMatchObject({ key: "payments.dateBeforeMovement" });
  expect(await entries()).toBe(beforeReceiptVoid);
  expect((await getReceipt(actor, receipt.id))!).toMatchObject({ status: "POSTED", voidEntryId: null });
  expect(await getInvoiceOpenCents(actor, invoiceId)).toBe(9498n);

  const refundedCredit = await credit();
  const refundTarget = await invoice();
  const refund = await recordCustomerRefund(actor, { creditNoteId: refundedCredit, amountCents: "1000", expectedOpenCents: String(total), date: "2026-06-10", accountId: W.bank, method: "EFT" }, { now });
  await applyCustomerCredit(actor, input(refundedCredit, refundTarget, { amountCents: "1000", expectedCreditCents: "10498", date: "2026-06-20" }), { now });
  const beforeRefundVoid = await entries();
  await expect(voidCustomerRefund(actor, refund.id, { date: "2026-06-15", reason: "Before later application" })).rejects.toMatchObject({ key: "refunds.dateBeforeMovement" });
  expect(await entries()).toBe(beforeRefundVoid);
  expect((await getCustomerRefund(actor, refund.id))!).toMatchObject({ status: "POSTED", voidEntryId: null });
  expect(await getCreditOpenCents(actor, refundedCredit)).toBe(9498n);
});

it("does not link different customers, companies or document kinds", async () => {
  const creditNoteId = await credit();
  const invoiceId = await invoice(W.otherCustomer);
  await expect(applyCustomerCredit(actor, input(creditNoteId, invoiceId), { now })).rejects.toMatchObject({ key: "salesApplications.customerMismatch" });
  await expect(applyCustomerCredit(other, input(creditNoteId, invoiceId), { now })).rejects.toMatchObject({ key: "salesApplications.creditNotFound" });
  await expect(applyCustomerCredit(actor, input(creditNoteId, creditNoteId), { now })).rejects.toMatchObject({ key: "salesApplications.invoiceNotFound" });
  await expect(applyCustomerCredit(actor, input(invoiceId, creditNoteId), { now })).rejects.toMatchObject({ key: "salesApplications.creditNotFound" });
  await expect(listCreditApplications(other, creditNoteId)).rejects.toMatchObject({ key: "salesApplications.creditNotFound" });
  await expect(unapplyCustomerCredit(actor, "invalid", { date: "2026-06-20" }, { now })).rejects.toMatchObject({ key: "salesApplications.invalid" });
});

it("serializes competing applications against the reviewed credit balance", async () => {
  const creditNoteId = await credit();
  const left = await invoice();
  const right = await invoice();
  const results = await Promise.allSettled([
    applyCustomerCredit(actor, input(creditNoteId, left, { amountCents: String(total) }), { now }),
    applyCustomerCredit(actor, input(creditNoteId, right, { amountCents: String(total) }), { now }),
  ]);
  expect(results.filter(row => row.status === "fulfilled")).toHaveLength(1);
  expect(results.find(row => row.status === "rejected")).toMatchObject({ reason: { key: "salesApplications.stale" } });
  expect(await getCreditOpenCents(actor, creditNoteId)).toBe(0n);
  expect((await listCreditApplications(actor, creditNoteId)).total).toBe(1);
});

it("serializes an invoice receipt against a credit application without oversettlement", async () => {
  const creditNoteId = await credit();
  const invoiceId = await invoice();
  const results = await Promise.allSettled([
    applyCustomerCredit(actor, input(creditNoteId, invoiceId, { amountCents: String(total) }), { now }),
    recordReceipt(actor, { invoiceId, amountCents: String(total), expectedOpenCents: String(total), date: "2026-06-10", accountId: W.bank, method: "EFT" }, { now }),
  ]);
  expect(results.filter(row => row.status === "fulfilled")).toHaveLength(1);
  expect(await getInvoiceOpenCents(actor, invoiceId)).toBe(0n);
  expect(await getCreditOpenCents(actor, creditNoteId)).toBe(results[0]?.status === "fulfilled" ? 0n : total);
});

it("requires both sales and accounting permissions but no contact permission", async () => {
  const creditNoteId = await credit();
  const invoiceId = await invoice();
  await expect(applyCustomerCredit(reader, input(creditNoteId, invoiceId), { now })).rejects.toMatchObject({ key: "forbidden" });
  const permissions = async (access: Record<string, string | undefined>) => db.query("UPDATE membership SET module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2", [W.companyA, W.userAccountant, JSON.stringify(access)]);
  try {
    await permissions({ contacts: "none" });
    const { id } = await applyCustomerCredit(accountant, input(creditNoteId, invoiceId), { now });
    expect((await listCreditApplications(accountant, creditNoteId)).applications[0]?.id).toBe(id);
    await unapplyCustomerCredit(accountant, id, { date: "2026-06-15" }, { now });
    for (const access of [{ sales: "write", accounting: "read" }, { sales: "read", accounting: "write" }]) {
      await permissions(access);
      await expect(applyCustomerCredit(accountant, input(creditNoteId, invoiceId, { date: "2026-06-15" }), { now })).rejects.toMatchObject({ key: "forbidden" });
      await expect(unapplyCustomerCredit(accountant, id, { date: "2026-06-15" }, { now })).rejects.toMatchObject({ key: "forbidden" });
    }
    for (const access of [{ sales: "none" }, { accounting: "none" }]) {
      await permissions(access);
      await expect(listCreditApplicationTargets(accountant, creditNoteId)).rejects.toMatchObject({ key: "forbidden" });
      await expect(listCreditApplications(accountant, creditNoteId)).rejects.toMatchObject({ key: "forbidden" });
    }
  } finally { await permissions({}); }
});

it("searches target numbers and references literally and keeps application history paginated", async () => {
  const creditNoteId = await credit();
  const invoiceId = await invoice(W.customer, "credit-picker-%_token");
  for (const query of ["contains\u0000nul", "new\nline", "tab\tvalue", "delete\u007f", "x".repeat(101)]) {
    await expect(listCreditApplicationTargets(reader, creditNoteId, query)).rejects.toMatchObject({ key: "salesApplications.invalid" });
  }
  const targets = await listCreditApplicationTargets(reader, creditNoteId, "%_token");
  expect(targets.invoices.map(row => row.id)).toEqual([invoiceId]);
  expect(targets.invoices[0]).toMatchObject({ date: "2026-06-01", openCents: total, totalCents: total });
  const number = (await getInvoice(actor, invoiceId))!.number!;
  expect((await listCreditApplicationTargets(actor, creditNoteId, number)).invoices.map(row => row.id)).toEqual([invoiceId]);
  for (let n = 0; n < 27; n++) {
    const { id } = await applyCustomerCredit(actor, input(creditNoteId, invoiceId), { now });
    await unapplyCustomerCredit(actor, id, { date: "2026-06-10" }, { now });
  }
  const first = await listCreditApplications(actor, creditNoteId);
  const last = await listCreditApplications(actor, creditNoteId, 999);
  expect(first).toMatchObject({ total: 27, page: 1, pageCount: 2 });
  expect(first.applications).toHaveLength(25);
  expect(last).toMatchObject({ total: 27, page: 2, pageCount: 2 });
  expect(last.applications).toHaveLength(2);
  expect(new Set([...first.applications, ...last.applications].map(row => row.id)).size).toBe(27);
});

it("refuses apply and release dates in a locked period", async () => {
  const creditNoteId = await credit();
  const invoiceId = await invoice();
  const { id } = await applyCustomerCredit(actor, input(creditNoteId, invoiceId), { now });
  const target = await invoice();
  const period = (await db.query("SELECT id FROM fiscal_period WHERE company_id=$1 AND '2026-06-15' BETWEEN start_date AND end_date", [W.companyA])).rows[0].id;
  await db.query("UPDATE fiscal_period SET status='LOCKED',locked_at=now(),locked_by_id=$2 WHERE id=$1", [period, W.userOwnerA]);
  try {
    await expect(unapplyCustomerCredit(actor, id, { date: "2026-06-15" }, { now })).rejects.toMatchObject({ key: "salesApplications.periodClosed" });
    await expect(applyCustomerCredit(actor, input(creditNoteId, target, { expectedCreditCents: "6498" }), { now })).rejects.toMatchObject({ key: "salesApplications.periodClosed" });
  } finally { await db.query("UPDATE fiscal_period SET status='OPEN',locked_at=NULL,locked_by_id=NULL WHERE id=$1", [period]); }
});
