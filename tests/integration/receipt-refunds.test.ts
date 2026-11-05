import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import type pg from "pg";
import { recordOnAccountReceipt, recordReceiptRefund, listReceiptRefunds, getReceiptOpenCents, getCustomerRefund, listCustomerRefunds, listCustomerRefundOrigins, voidCustomerRefund, voidReceipt, applyReceiptToInvoice, unapplyReceiptAllocation } from "@/modules/payments";
import { getDraft, saveDraft, postInvoice } from "@/modules/sales";
import { withCompany } from "@/platform/tenant";
import { owner } from "./helpers";
import { seedWorld, W } from "./world";

const actor = { companyId: W.companyA, userId: W.userOwnerA };
const accountant = { ...actor, userId: W.userAccountant };
const reader = { ...actor, userId: W.userReader };
const other = { companyId: W.companyB, userId: W.userOwnerB };
const now = new Date("2026-10-31T12:00:00Z");
let db: pg.Client;
beforeAll(async () => {
  db = await owner();
  await seedWorld(db);
  await db.query("INSERT INTO number_sequence(company_id,key,next_value,prefix,padding) VALUES ($1,'JOURNAL_ENTRY',1,'J-',5),($1,'INVOICE',1,'F-',5),($1,'PAYMENT_RECEIVED',1,'E-',5),($1,'PAYMENT_SENT',1,'R-',5)", [W.companyA]);
});
afterAll(async () => { await db?.end(); });
const entries = async () => Number((await db.query("SELECT count(*) AS n FROM journal_entry WHERE company_id=$1", [W.companyA])).rows[0].n);
async function receipt() {
  return recordOnAccountReceipt(actor, { submissionId: randomUUID(), contactId: W.customer, amountCents: "10000", date: "2026-06-01", accountId: W.bank, method: "EFT" }, { now });
}
const refundInput = (receiptId: string, over: Record<string, unknown> = {}) => ({ submissionId: randomUUID(), receiptId, expectedOpenCents: "10000", amountCents: "3000", date: "2026-06-10", accountId: W.bank, method: "EFT", ...over });
async function invoice() {
  const id = await saveDraft(actor, { contactId: W.customer, issueDate: "2026-06-01", dueDate: "2026-07-01", lines: [{ description: "Service", quantity: "1", unitPrice: "100", accountId: W.sales, taxCodeId: W.taxCodeExempt }] });
  await postInvoice(actor, id, (await getDraft(actor, id))!.revision, "2026-06-01");
  return id;
}

it("records a bank refund and a full compensation without a fake credit note", async () => {
  const source = await receipt();
  const before = await entries();
  const refund = await recordReceiptRefund(actor, refundInput(source.id, { reference: "Receipt refund alpha45", memo: "Returned to customer" }), { now });
  expect(await entries()).toBe(before + 1);
  expect(await getReceiptOpenCents(reader, source.id)).toBe(7000n);
  const detail = (await getCustomerRefund(reader, refund.id))!;
  expect(detail).toMatchObject({ amountCents: 3000n, customer: "Client Fictif", allocations: [], receiptSources: [{ id: source.id, number: source.number }] });
  const lines = (await db.query("SELECT account_id,debit_cents::text AS debit,credit_cents::text AS credit,contact_id,tax_id FROM journal_line WHERE entry_id=$1 ORDER BY line_no", [detail.journalEntryId])).rows;
  expect(lines).toEqual([{ account_id: W.bank, debit: "0", credit: "3000", contact_id: null, tax_id: null }, { account_id: W.receivable, debit: "3000", credit: "0", contact_id: W.customer, tax_id: null }]);
  const origins = await listCustomerRefundOrigins(reader, refund.id);
  expect(origins.origins).toEqual([expect.objectContaining({ kind: "RECEIPT", sourceId: source.id, amountCents: 3000n, appliedDate: "2026-06-10", unappliedDate: null })]);
  const history = await listReceiptRefunds(reader, source.id);
  expect(history.refunds).toEqual([expect.objectContaining({ id: origins.origins[0]!.id, paymentId: refund.id, amountCents: 3000n, offsetCents: 3000n, appliedDate: "2026-06-10", unappliedDate: null })]);
  expect((await listCustomerRefunds(reader, 1, { q: source.number })).refunds.map(row => row.id)).toContain(refund.id);
  await expect(voidReceipt(actor, source.id, { date: "2026-06-10", reason: "Refund is active" })).rejects.toMatchObject({ key: "payments.offsetsLinked" });
});

it("deduplicates concurrent submissions and a replay after void without consuming extra numbers", async () => {
  const source = await receipt();
  const input = refundInput(source.id);
  const before = await entries();
  const [left, right] = await Promise.all([recordReceiptRefund(actor, input, { now }), recordReceiptRefund(actor, input, { now })]);
  expect(left).toEqual(right);
  expect(await entries()).toBe(before + 1);
  const sequence = async () => (await db.query("SELECT next_value::text AS n FROM number_sequence WHERE company_id=$1 AND key='PAYMENT_SENT'", [W.companyA])).rows[0].n;
  const numbered = await sequence();
  for (const over of [{ amountCents: "2999" }, { date: "2026-06-11" }, { memo: "Changed" }, { reference: "Changed" }, { accountId: W.undeposited }, { method: "CASH" }]) await expect(recordReceiptRefund(actor, { ...input, ...over }, { now })).rejects.toMatchObject({ key: "receiptRefunds.idempotency" });
  await expect(recordReceiptRefund(accountant, input, { now })).rejects.toMatchObject({ key: "receiptRefunds.idempotency" });
  await voidCustomerRefund(actor, left.id, { date: "2026-06-15", reason: "Returned in error" });
  const afterVoid = await entries();
  expect(await recordReceiptRefund(actor, input, { now })).toEqual(left);
  expect(await entries()).toBe(afterVoid);
  expect(await sequence()).toBe(numbered);
  expect(await getReceiptOpenCents(actor, source.id)).toBe(10000n);
  expect((await listReceiptRefunds(actor, source.id)).refunds[0]).toMatchObject({ status: "VOID", unappliedDate: "2026-06-15" });
  const differentSource = await receipt();
  await expect(recordReceiptRefund(actor, { ...input, receiptId: differentSource.id }, { now })).rejects.toMatchObject({ key: "receiptRefunds.idempotency" });
});

it("refuses invalid, stale or excessive refunds atomically and keeps source/company scope", async () => {
  const source = await receipt();
  const before = await entries();
  const sequence = (await db.query("SELECT next_value::text AS n FROM number_sequence WHERE company_id=$1 AND key='PAYMENT_SENT'", [W.companyA])).rows[0].n;
  for (const [over, key] of [
    [{ amountCents: "0" }, "receiptRefunds.invalid"], [{ amountCents: "1.5" }, "receiptRefunds.invalid"], [{ submissionId: "invalid" }, "receiptRefunds.invalid"], [{ memo: "nul\u0000" }, "receiptRefunds.invalid"],
    [{ date: "2027-01-01" }, "receiptRefunds.futureDate"], [{ date: "2026-02-30" }, "receiptRefunds.invalid"], [{ date: "2026-05-31" }, "receiptRefunds.dateBeforeMovement"],
    [{ expectedOpenCents: "0" }, "receiptRefunds.stale"], [{ amountCents: "10001" }, "receiptRefunds.exceeds"], [{ accountId: W.undeposited }, "refunds.account"], [{ accountId: W.bankB }, "refunds.account"], [{ accountId: W.sales }, "refunds.account"],
  ] as const) await expect(recordReceiptRefund(actor, refundInput(source.id, over), { now })).rejects.toMatchObject({ key });
  await expect(recordReceiptRefund(other, refundInput(source.id), { now })).rejects.toMatchObject({ key: "receiptRefunds.receiptNotFound" });
  expect(await entries()).toBe(before);
  expect((await db.query("SELECT next_value::text AS n FROM number_sequence WHERE company_id=$1 AND key='PAYMENT_SENT'", [W.companyA])).rows[0].n).toBe(sequence);
  expect(await getReceiptOpenCents(actor, source.id)).toBe(10000n);
  const refund = await recordReceiptRefund(actor, refundInput(source.id), { now });
  await expect(recordReceiptRefund(actor, refundInput(refund.id), { now })).rejects.toMatchObject({ key: "receiptRefunds.receiptNotFound" });
  await expect(getCustomerRefund(other, refund.id)).resolves.toBeNull();
  await expect(listCustomerRefundOrigins(other, refund.id)).rejects.toMatchObject({ key: "refunds.notFound" });
  await expect(voidCustomerRefund(other, refund.id, { date: "2026-06-15", reason: "Other company" })).rejects.toMatchObject({ key: "refunds.notFound" });
});

it("serializes two refunds and allocations against the same reviewed receipt balance", async () => {
  const source = await receipt();
  const competing = await Promise.allSettled([recordReceiptRefund(actor, refundInput(source.id, { amountCents: "10000" }), { now }), recordReceiptRefund(actor, refundInput(source.id, { amountCents: "10000" }), { now })]);
  expect(competing.filter(row => row.status === "fulfilled")).toHaveLength(1);
  expect(competing.find(row => row.status === "rejected")).toMatchObject({ reason: { key: "receiptRefunds.stale" } });
  const fresh = await receipt();
  const target = await invoice();
  const results = await Promise.allSettled([recordReceiptRefund(actor, refundInput(fresh.id, { amountCents: "10000" }), { now }), applyReceiptToInvoice(actor, { paymentId: fresh.id, invoiceId: target, amountCents: "10000", expectedPaymentCents: "10000", expectedInvoiceCents: "10000", date: "2026-06-10" }, { now })]);
  expect(results.filter(row => row.status === "fulfilled")).toHaveLength(1);
  expect(await getReceiptOpenCents(actor, fresh.id)).toBe(0n);
});

it("voids through sorted payment-pair locks while another refund competes for the source", async () => {
  const source = await receipt();
  const initial = await recordReceiptRefund(actor, refundInput(source.id, { amountCents: "1000" }), { now });
  const results = await Promise.allSettled([voidCustomerRefund(actor, initial.id, { date: "2026-06-20", reason: "Refund reversal" }), recordReceiptRefund(actor, refundInput(source.id, { amountCents: "500", expectedOpenCents: "9000", date: "2026-06-20" }), { now })]);
  expect(results[0]?.status).toBe("fulfilled");
  expect(await getReceiptOpenCents(actor, source.id)).toBe(results[1]?.status === "fulfilled" ? 9500n : 10000n);
  if (results[1]?.status === "rejected") expect(results[1]).toMatchObject({ reason: { key: "receiptRefunds.stale" } });
  expect((await getCustomerRefund(actor, initial.id))!.status).toBe("VOID");
});

it("keeps dates monotone after a source allocation release and before later movements", async () => {
  const source = await receipt();
  const target = await invoice();
  const allocation = await applyReceiptToInvoice(actor, { paymentId: source.id, invoiceId: target, amountCents: "1000", expectedPaymentCents: "10000", expectedInvoiceCents: "10000", date: "2026-06-10" }, { now });
  await unapplyReceiptAllocation(actor, allocation.id, { date: "2026-06-20" }, { now });
  await expect(recordReceiptRefund(actor, refundInput(source.id, { date: "2026-06-15" }), { now })).rejects.toMatchObject({ key: "receiptRefunds.dateBeforeMovement" });
  const refund = await recordReceiptRefund(actor, refundInput(source.id, { date: "2026-06-20" }), { now });
  await applyReceiptToInvoice(actor, { paymentId: source.id, invoiceId: target, amountCents: "1000", expectedPaymentCents: "7000", expectedInvoiceCents: "10000", date: "2026-06-25" }, { now });
  const before = await entries();
  await expect(voidCustomerRefund(actor, refund.id, { date: "2026-06-21", reason: "Too early" })).rejects.toMatchObject({ key: "refunds.dateBeforeMovement" });
  expect(await entries()).toBe(before);
  await voidCustomerRefund(actor, refund.id, { date: "2026-06-25", reason: "Now available" });
  expect(await getReceiptOpenCents(actor, source.id)).toBe(9000n);
});

it("requires sales and accounting but uses frozen source names without Contacts access", async () => {
  const source = await receipt();
  const target = await invoice();
  const allocation = await applyReceiptToInvoice(actor, { paymentId: source.id, invoiceId: target, amountCents: "1", expectedPaymentCents: "10000", expectedInvoiceCents: "10000", date: "2026-06-10" }, { now });
  await unapplyReceiptAllocation(actor, allocation.id, { date: "2026-06-10" }, { now });
  const permissions = async (access: Record<string, string | undefined>) => db.query("UPDATE membership SET module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2", [W.companyA, W.userAccountant, JSON.stringify(access)]);
  await expect(recordReceiptRefund(reader, refundInput(source.id), { now })).rejects.toMatchObject({ key: "forbidden" });
  try {
    await permissions({ contacts: "none" });
    const refund = await recordReceiptRefund(accountant, refundInput(source.id), { now });
    expect((await getCustomerRefund(accountant, refund.id, { includeOrigins: false }))!).toMatchObject({ customer: "Client Fictif", allocations: [], receiptSources: [{ id: source.id, number: source.number }] });
    expect((await listCustomerRefunds(accountant, 1, { q: source.number })).refunds.find(row => row.id === refund.id)?.customer).toBe("Client Fictif");
    expect((await listCustomerRefunds(accountant, 1, { q: "Client Fictif" })).refunds.map(row => row.id)).toContain(refund.id);
    await voidCustomerRefund(accountant, refund.id, { date: "2026-06-15", reason: "Returned in error" });
    for (const access of [{ sales: "write", accounting: "read" }, { sales: "read", accounting: "write" }]) {
      await permissions(access);
      await expect(recordReceiptRefund(accountant, refundInput(source.id, { date: "2026-06-15" }), { now })).rejects.toMatchObject({ key: "forbidden" });
      await expect(voidCustomerRefund(accountant, refund.id, { date: "2026-06-15", reason: "No access" })).rejects.toMatchObject({ key: "forbidden" });
    }
    for (const access of [{ sales: "none" }, { accounting: "none" }]) {
      await permissions(access);
      await expect(listReceiptRefunds(accountant, source.id)).rejects.toMatchObject({ key: "forbidden" });
      await expect(listCustomerRefundOrigins(accountant, refund.id)).rejects.toMatchObject({ key: "forbidden" });
    }
  } finally { await permissions({}); }
});

it("paginates legacy multi-source offsets truthfully and releases every active origin when voiding", async () => {
  const source = await receipt();
  const second = await receipt();
  const refund = await recordReceiptRefund(actor, refundInput(source.id, { amountCents: "10000" }), { now });
  const original = (await listReceiptRefunds(actor, source.id)).refunds[0]!;
  await withCompany(actor, tx => tx.paymentOffset.update({ where: { id: original.id, companyId: actor.companyId }, data: { unappliedDate: new Date("2026-06-10T00:00:00Z"), unappliedById: actor.userId } }));
  for (let n = 0; n < 26; n++) await withCompany(actor, async tx => {
    const row = await tx.paymentOffset.create({ data: { companyId: actor.companyId, receivedPaymentId: source.id, sentPaymentId: refund.id, amountCents: 1n, appliedDate: new Date("2026-06-10T00:00:00Z"), createdById: actor.userId } });
    await tx.paymentOffset.update({ where: { id: row.id, companyId: actor.companyId }, data: { unappliedDate: new Date("2026-06-10T00:00:00Z"), unappliedById: actor.userId } });
    await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
  });
  await withCompany(actor, tx => tx.paymentOffset.create({ data: { companyId: actor.companyId, receivedPaymentId: second.id, sentPaymentId: refund.id, amountCents: 100n, appliedDate: new Date("2026-06-10T00:00:00Z"), createdById: actor.userId } }));
  const firstPage = await listCustomerRefundOrigins(actor, refund.id);
  const lastPage = await listCustomerRefundOrigins(actor, refund.id, 999);
  expect(firstPage).toMatchObject({ total: 28, page: 1, pageCount: 2 });
  expect(firstPage.origins).toHaveLength(25);
  expect(lastPage.origins).toHaveLength(3);
  expect(new Set([...firstPage.origins, ...lastPage.origins].map(row => row.id)).size).toBe(28);
  expect(new Set([...firstPage.origins, ...lastPage.origins].map(row => row.sourceId))).toEqual(new Set([source.id, second.id]));
  const receipts = await listReceiptRefunds(actor, source.id, 999);
  expect(receipts).toMatchObject({ total: 27, page: 2, pageCount: 2 });
  expect(receipts.refunds).toHaveLength(2);
  expect(receipts.refunds[0]).toMatchObject({ paymentId: refund.id, amountCents: 10000n });
  expect((await getCustomerRefund(actor, refund.id, { includeOrigins: false }))!.hasMoreOrigins).toBe(true);
  await voidCustomerRefund(actor, refund.id, { date: "2026-06-15", reason: "Cancel legacy refund" });
  expect(await getReceiptOpenCents(actor, source.id)).toBe(10000n);
  expect(await getReceiptOpenCents(actor, second.id)).toBe(10000n);
  expect((await listCustomerRefundOrigins(actor, refund.id)).origins.every(row => row.unappliedDate !== null)).toBe(true);
});
