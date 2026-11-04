import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import type pg from "pg";
import { recordOnAccountReceipt, applyReceiptToInvoice, unapplyReceiptAllocation, getReceiptOpenCents, listReceiptAllocationTargets, listReceiptAllocations, getReceipt, listReceipts, listReceiptAccounts, listInvoicePayments, recordReceipt, voidReceipt, recordDeposit } from "@/modules/payments";
import { getDraft, getInvoiceOpenCents, getCreditOpenCents, postInvoice, saveDraft } from "@/modules/sales";
import { getReceivablesAging } from "@/modules/reports";
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
  await db.query("INSERT INTO number_sequence(company_id,key,next_value,prefix,padding) VALUES ($1,'JOURNAL_ENTRY',1,'J-',5),($1,'INVOICE',1,'F-',5),($1,'CREDIT_NOTE',1,'AV-',5),($1,'PAYMENT_RECEIVED',1,'E-',5),($1,'DEPOSIT',1,'D-',5)", [W.companyA]);
});
afterAll(async () => { await db?.end(); });
const receiptInput = (over: Record<string, unknown> = {}) => ({ submissionId: randomUUID(), contactId: W.customer, amountCents: "10000", date: "2026-06-01", accountId: W.bank, method: "EFT", ...over });
const allocationInput = (paymentId: string, invoiceId: string, over: Record<string, unknown> = {}) => ({ paymentId, invoiceId, amountCents: "3000", expectedPaymentCents: "10000", expectedInvoiceCents: "10000", date: "2026-06-10", ...over });
const entries = async () => Number((await db.query("SELECT count(*) AS n FROM journal_entry WHERE company_id=$1", [W.companyA])).rows[0].n);
async function invoice(contactId: string = W.customer, reference = "") {
  const id = await saveDraft(actor, { contactId, issueDate: "2026-06-01", dueDate: "2026-07-01", reference, lines: [{ description: "Service", quantity: "1", unitPrice: "100", accountId: W.sales, taxCodeId: W.taxCodeExempt }] });
  await postInvoice(actor, id, (await getDraft(actor, id))!.revision, "2026-06-01");
  return id;
}

it("posts a receipt on account once, with the customer's receivable credit and no allocation", async () => {
  const input = receiptInput({ reference: "Advance 104", memo: "Received before invoice" });
  const before = await entries();
  const payment = await recordOnAccountReceipt(actor, input, { now });
  expect(payment.id).toBe(input.submissionId);
  expect(await entries()).toBe(before + 1);
  expect(await getReceiptOpenCents(reader, payment.id)).toBe(10000n);
  const detail = (await getReceipt(reader, payment.id))!;
  expect(detail).toMatchObject({ amountCents: 10000n, openCents: 10000n, customer: "Client Fictif", reference: "Advance 104", memo: "Received before invoice" });
  expect(detail.allocations).toEqual([]);
  const lines = (await db.query("SELECT account_id,debit_cents::text AS debit,credit_cents::text AS credit,contact_id FROM journal_line WHERE entry_id=$1 ORDER BY line_no", [detail.journalEntryId])).rows;
  expect(lines).toEqual([{ account_id: W.bank, debit: "10000", credit: "0", contact_id: null }, { account_id: W.receivable, debit: "0", credit: "10000", contact_id: W.customer }]);
  const result = (await listReceipts(reader, 1, { q: "Advance 104" })).receipts.find(row => row.id === payment.id)!;
  expect(result).toMatchObject({ availableCents: 10000n, hasMoreAllocations: false, invoices: [] });
});

it("makes concurrent retries idempotent, rejects changed payloads and never recreates a voided submission", async () => {
  const input = receiptInput();
  const before = await entries();
  const [left, right] = await Promise.all([recordOnAccountReceipt(actor, input, { now }), recordOnAccountReceipt(actor, input, { now })]);
  expect(left).toEqual(right);
  expect(await entries()).toBe(before + 1);
  for (const over of [{ amountCents: "9999" }, { contactId: W.otherCustomer }, { date: "2026-06-02" }, { reference: "changed" }, { memo: "changed" }, { accountId: W.undeposited }, { method: "CASH" }]) await expect(recordOnAccountReceipt(actor, { ...input, ...over }, { now })).rejects.toMatchObject({ key: "onAccountReceipts.idempotency" });
  await expect(recordOnAccountReceipt(accountant, input, { now })).rejects.toMatchObject({ key: "onAccountReceipts.idempotency" });
  await voidReceipt(actor, left.id, { date: "2026-06-02", reason: "Duplicate bank entry" });
  const afterVoid = await entries();
  expect(await recordOnAccountReceipt(actor, input, { now })).toEqual(left);
  expect(await entries()).toBe(afterVoid);
  expect(await getReceiptOpenCents(actor, left.id)).toBe(0n);
  expect((await getReceipt(actor, left.id))!).toMatchObject({ status: "VOID", openCents: 0n });
});

it("validates customer, amount, dates and accounts before consuming a receipt number", async () => {
  const sequence = async () => (await db.query("SELECT next_value::text AS n FROM number_sequence WHERE company_id=$1 AND key='PAYMENT_RECEIVED'", [W.companyA])).rows[0].n;
  const before = await sequence();
  for (const [over, key] of [
    [{ amountCents: "0" }, "onAccountReceipts.invalid"], [{ amountCents: "1.5" }, "onAccountReceipts.invalid"], [{ submissionId: "bad" }, "onAccountReceipts.invalid"],
    [{ date: "2026-02-30" }, "onAccountReceipts.invalid"], [{ date: "2027-01-01" }, "onAccountReceipts.futureDate"], [{ memo: "nul\u0000" }, "onAccountReceipts.invalid"],
    [{ contactId: W.supplier }, "onAccountReceipts.customer"], [{ contactId: W.bankB }, "onAccountReceipts.customer"], [{ accountId: W.bankB }, "payments.account"], [{ accountId: W.sales }, "payments.account"],
  ] as const) await expect(recordOnAccountReceipt(actor, receiptInput(over), { now })).rejects.toMatchObject({ key });
  await db.query("UPDATE contact SET is_active=false WHERE company_id=$1 AND id=$2", [W.companyA, W.otherCustomer]);
  try { await expect(recordOnAccountReceipt(actor, receiptInput({ contactId: W.otherCustomer }), { now })).rejects.toMatchObject({ key: "onAccountReceipts.customer" }); }
  finally { await db.query("UPDATE contact SET is_active=true WHERE company_id=$1 AND id=$2", [W.companyA, W.otherCustomer]); }
  expect(await sequence()).toBe(before);
});

it("applies and releases partial amounts without another journal, retaining dated history", async () => {
  const payment = await recordOnAccountReceipt(actor, receiptInput(), { now });
  const invoiceId = await invoice();
  const before = await entries();
  const { id } = await applyReceiptToInvoice(actor, allocationInput(payment.id, invoiceId), { now });
  expect(await entries()).toBe(before);
  expect(await getReceiptOpenCents(actor, payment.id)).toBe(7000n);
  expect(await getInvoiceOpenCents(actor, invoiceId)).toBe(7000n);
  expect((await listReceiptAllocations(reader, payment.id)).allocations).toEqual([expect.objectContaining({ id, invoiceId, amountCents: 3000n, appliedDate: "2026-06-10", unappliedDate: null })]);
  expect((await listReceiptAllocationTargets(reader, payment.id)).invoices.map(row => row.id)).not.toContain(invoiceId);
  await expect(applyReceiptToInvoice(actor, allocationInput(payment.id, invoiceId, { expectedPaymentCents: "7000", expectedInvoiceCents: "7000" }), { now })).rejects.toMatchObject({ key: "receiptAllocations.alreadyApplied" });
  await unapplyReceiptAllocation(actor, id, { date: "2026-06-15" }, { now });
  await unapplyReceiptAllocation(actor, id, { date: "2026-06-20" }, { now });
  expect((await listReceiptAllocations(actor, payment.id)).allocations[0]).toMatchObject({ id, unappliedDate: "2026-06-15" });
  expect(await getReceiptOpenCents(actor, payment.id)).toBe(10000n);
  expect(await getInvoiceOpenCents(actor, invoiceId)).toBe(10000n);
  expect(await entries()).toBe(before);
  const events = (await db.query("SELECT action FROM audit_log WHERE company_id=$1 AND entity_type='payment_allocation' AND entity_id=$2 ORDER BY occurred_at,id", [W.companyA, id])).rows;
  expect(events.map(row => row.action)).toEqual(["row.insert", "row.update"]);
});

it("rejects stale balances and restores availability only from the actual release date across invoices", async () => {
  const payment = await recordOnAccountReceipt(actor, receiptInput(), { now });
  const first = await invoice();
  const second = await invoice();
  for (const [over, key] of [[{ expectedPaymentCents: "0" }, "stale"], [{ expectedInvoiceCents: "0" }, "stale"], [{ amountCents: "10001" }, "exceeds"], [{ amountCents: "0" }, "invalid"], [{ date: "2026-05-31" }, "dateBeforeMovement"], [{ date: "2027-01-01" }, "futureDate"]] as const) await expect(applyReceiptToInvoice(actor, allocationInput(payment.id, first, over), { now })).rejects.toMatchObject({ key: `receiptAllocations.${key}` });
  const { id } = await applyReceiptToInvoice(actor, allocationInput(payment.id, first, { amountCents: "10000" }), { now });
  await unapplyReceiptAllocation(actor, id, { date: "2026-06-20" }, { now });
  await expect(applyReceiptToInvoice(actor, allocationInput(payment.id, second, { date: "2026-06-15" }), { now })).rejects.toMatchObject({ key: "receiptAllocations.dateBeforeMovement" });
  await expect(voidReceipt(actor, payment.id, { date: "2026-06-15", reason: "Too early" })).rejects.toMatchObject({ key: "payments.dateBeforeMovement" });
  await applyReceiptToInvoice(actor, allocationInput(payment.id, second, { date: "2026-06-20" }), { now });
  expect(await getReceiptOpenCents(actor, payment.id)).toBe(7000n);
  const aging = await getReceivablesAging(actor, { asOf: "2026-06-15" });
  expect(aging.differenceCents).toBe(0n);
});

it("serializes allocations competing for a payment and receipts competing for an invoice", async () => {
  const payment = await recordOnAccountReceipt(actor, receiptInput(), { now });
  const first = await invoice();
  const second = await invoice();
  const competing = await Promise.allSettled([applyReceiptToInvoice(actor, allocationInput(payment.id, first, { amountCents: "10000" }), { now }), applyReceiptToInvoice(actor, allocationInput(payment.id, second, { amountCents: "10000" }), { now })]);
  expect(competing.filter(row => row.status === "fulfilled")).toHaveLength(1);
  expect(competing.find(row => row.status === "rejected")).toMatchObject({ reason: { key: "receiptAllocations.stale" } });
  const fresh = await recordOnAccountReceipt(actor, receiptInput(), { now });
  const target = await invoice();
  const outcomes = await Promise.allSettled([applyReceiptToInvoice(actor, allocationInput(fresh.id, target, { amountCents: "10000" }), { now }), recordReceipt(actor, { invoiceId: target, amountCents: "10000", expectedOpenCents: "10000", date: "2026-06-10", accountId: W.bank, method: "EFT" }, { now })]);
  expect(outcomes.filter(row => row.status === "fulfilled")).toHaveLength(1);
  expect(await getInvoiceOpenCents(actor, target)).toBe(0n);
});

it("enforces scope and both modules, while existing receipts remain usable without Contact access", async () => {
  const payment = await recordOnAccountReceipt(actor, receiptInput(), { now });
  const target = await invoice();
  const wrongCustomer = await invoice(W.otherCustomer);
  await expect(applyReceiptToInvoice(actor, allocationInput(payment.id, wrongCustomer), { now })).rejects.toMatchObject({ key: "receiptAllocations.customerMismatch" });
  await expect(applyReceiptToInvoice(other, allocationInput(payment.id, target), { now })).rejects.toMatchObject({ key: "receiptAllocations.paymentNotFound" });
  await expect(listReceiptAllocations(other, payment.id)).rejects.toMatchObject({ key: "receiptAllocations.paymentNotFound" });
  await expect(applyReceiptToInvoice(reader, allocationInput(payment.id, target), { now })).rejects.toMatchObject({ key: "forbidden" });
  const permissions = async (access: Record<string, string | undefined>) => db.query("UPDATE membership SET module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2", [W.companyA, W.userAccountant, JSON.stringify(access)]);
  try {
    await permissions({ contacts: "none" });
    await expect(recordOnAccountReceipt(accountant, receiptInput(), { now })).rejects.toMatchObject({ key: "forbidden" });
    const { id } = await applyReceiptToInvoice(accountant, allocationInput(payment.id, target), { now });
    expect((await getReceipt(accountant, payment.id, { includeAllocations: false }))!).toMatchObject({ customer: "Client Fictif", allocations: [], openCents: 7000n });
    expect((await listReceiptAllocations(accountant, payment.id)).total).toBe(1);
    await unapplyReceiptAllocation(accountant, id, { date: "2026-06-15" }, { now });
    for (const access of [{ sales: "write", accounting: "read" }, { sales: "read", accounting: "write" }]) {
      await permissions(access);
      await expect(applyReceiptToInvoice(accountant, allocationInput(payment.id, target, { date: "2026-06-15" }), { now })).rejects.toMatchObject({ key: "forbidden" });
      await expect(recordOnAccountReceipt(accountant, receiptInput(), { now })).rejects.toMatchObject({ key: "forbidden" });
      await expect(unapplyReceiptAllocation(accountant, id, { date: "2026-06-15" }, { now })).rejects.toMatchObject({ key: "forbidden" });
    }
    await permissions({ accounting: "none" });
    for (const read of [() => getReceiptOpenCents(accountant, payment.id), () => listReceiptAllocations(accountant, payment.id), () => listReceiptAllocationTargets(accountant, payment.id), () => listReceiptAccounts(accountant), () => listInvoicePayments(accountant, target), () => getInvoiceOpenCents(accountant, target), () => getCreditOpenCents(accountant, randomUUID())]) await expect(read()).rejects.toMatchObject({ key: "forbidden" });
  } finally { await permissions({}); }
});

it("paginates allocation history, bounds receipt previews and treats picker wildcards literally", async () => {
  const payment = await recordOnAccountReceipt(actor, receiptInput({ reference: "History receipt alpha44" }), { now });
  const target = await invoice(W.customer, "receipt-picker-%_literal");
  expect((await listReceiptAllocationTargets(reader, payment.id, "%_literal")).invoices.map(row => row.id)).toEqual([target]);
  for (const q of ["bad\u0000query", "bad\nquery", "\u007f", "x".repeat(101)]) await expect(listReceiptAllocationTargets(reader, payment.id, q)).rejects.toMatchObject({ key: "receiptAllocations.invalid" });
  for (let n = 0; n < 27; n++) {
    const { id } = await applyReceiptToInvoice(actor, allocationInput(payment.id, target), { now });
    await unapplyReceiptAllocation(actor, id, { date: "2026-06-10" }, { now });
  }
  const first = await listReceiptAllocations(reader, payment.id);
  const last = await listReceiptAllocations(reader, payment.id, 999);
  expect(first).toMatchObject({ total: 27, page: 1, pageCount: 2 });
  expect(first.allocations).toHaveLength(25);
  expect(last.allocations).toHaveLength(2);
  expect(new Set([...first.allocations, ...last.allocations].map(row => row.id)).size).toBe(27);
  const listed = (await listReceipts(reader, 1, { q: "History receipt alpha44" })).receipts[0]!;
  expect(listed).toMatchObject({ id: payment.id, availableCents: 10000n, hasMoreAllocations: true });
  expect(listed.invoices).toHaveLength(1);
  expect((await getReceipt(actor, payment.id, { includeAllocations: false }))!.allocations).toEqual([]);
});

it("allows allocations after a bank deposit while keeping the deposited receipt immutable", async () => {
  const payment = await recordOnAccountReceipt(actor, receiptInput({ accountId: W.undeposited }), { now });
  const target = await invoice();
  await recordDeposit(actor, { paymentIds: [payment.id], accountId: W.bank, date: "2026-06-05", expectedTotalCents: "10000" });
  await applyReceiptToInvoice(actor, allocationInput(payment.id, target), { now });
  expect(await getReceiptOpenCents(actor, payment.id)).toBe(7000n);
  await expect(voidReceipt(actor, payment.id, { date: "2026-06-10", reason: "Deposit is still posted" })).rejects.toMatchObject({ key: "deposits.receiptBlocked" });
});

it("refuses allocation and release in locked periods and retains the original receipt", async () => {
  const payment = await recordOnAccountReceipt(actor, receiptInput(), { now });
  const target = await invoice();
  const otherTarget = await invoice();
  const { id } = await applyReceiptToInvoice(actor, allocationInput(payment.id, target), { now });
  const period = (await db.query("SELECT id FROM fiscal_period WHERE company_id=$1 AND '2026-06-15' BETWEEN start_date AND end_date", [W.companyA])).rows[0].id;
  await db.query("UPDATE fiscal_period SET status='LOCKED',locked_at=now(),locked_by_id=$2 WHERE id=$1", [period, W.userOwnerA]);
  try {
    await expect(unapplyReceiptAllocation(actor, id, { date: "2026-06-15" }, { now })).rejects.toMatchObject({ key: "receiptAllocations.periodClosed" });
    await expect(applyReceiptToInvoice(actor, allocationInput(payment.id, otherTarget, { expectedPaymentCents: "7000" }), { now })).rejects.toMatchObject({ key: "receiptAllocations.periodClosed" });
  } finally { await db.query("UPDATE fiscal_period SET status='OPEN',locked_at=NULL,locked_by_id=NULL WHERE id=$1", [period]); }
  expect((await getReceipt(actor, payment.id))!.status).toBe("POSTED");
});
