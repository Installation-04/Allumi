import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { getDraft, getInvoiceOpenCents, postInvoice, saveDraft } from "@/modules/sales";
import { applyReceiptToInvoice, getReceiptOpenCents, recordOnAccountReceipt, recordReceiptRefund, voidCustomerRefund } from "@/modules/payments";
import { getAccountLedger, getCashMovements, getCustomerStatement, getIncomeStatement, getReceivablesAging } from "@/modules/reports";
import { owner } from "./helpers";
import { seedWorld, W } from "./world";

const actor = { companyId: W.companyA, userId: W.userOwnerA };
const now = new Date("2026-12-31T12:00:00Z");
let db: pg.Client, invoiceId: string, receiptId: string, refundId: string;
beforeAll(async () => {
  db = await owner(); await seedWorld(db);
  await db.query("INSERT INTO number_sequence(company_id,key,next_value,prefix,padding) VALUES($1,'JOURNAL_ENTRY',1,'J-',5),($1,'INVOICE',1,'F-',5),($1,'PAYMENT_RECEIVED',1,'E-',5),($1,'PAYMENT_SENT',1,'R-',5)", [W.companyA]);
  invoiceId = await saveDraft(actor, { contactId: W.customer, issueDate: "2026-06-01", dueDate: "2026-07-01", lines: [{ description: "Service", quantity: "1", unitPrice: "100", accountId: W.sales, taxCodeId: W.taxCodeExempt }] });
  await postInvoice(actor, invoiceId, (await getDraft(actor, invoiceId))!.revision, "2026-06-01");
  receiptId = (await recordOnAccountReceipt(actor, { submissionId: randomUUID(), contactId: W.customer, amountCents: "10000", date: "2026-06-02", accountId: W.bank, method: "EFT" }, { now })).id;
  await applyReceiptToInvoice(actor, { paymentId: receiptId, invoiceId, amountCents: "4000", expectedPaymentCents: "10000", expectedInvoiceCents: "10000", date: "2026-06-03" }, { now });
});
afterAll(async () => { await db?.end(); });

async function assertControl(asOf: string, expected: bigint) {
  const aging = await getReceivablesAging(actor, { asOf });
  const ledger = await getAccountLedger(actor, { accountId: W.receivable, from: "2026-01-01", to: asOf });
  const statement = await getCustomerStatement(actor, { contactId: W.customer, from: "2026-01-01", to: asOf });
  expect(aging.differenceCents).toBe(0n);
  expect(aging.totalCents).toBe(expected);
  expect(aging.controlCents).toBe(expected);
  expect(ledger.closingCents).toBe(expected);
  expect(statement.closingCents).toBe(expected);
  return statement;
}

it("keeps the refund in cash, receivable aging and customer statements without another sale or tax", async () => {
  refundId = (await recordReceiptRefund(actor, { submissionId: randomUUID(), receiptId, expectedOpenCents: "6000", amountCents: "3000", date: "2026-06-04", accountId: W.bank, method: "EFT" }, { now })).id;
  await assertControl("2026-06-01", 10000n);
  await assertControl("2026-06-02", 0n);
  await assertControl("2026-06-03", 0n);
  const statement = await assertControl("2026-06-04", 3000n);
  expect(statement.rows.map(row => row.kind)).toEqual(["INVOICE", "RECEIPT", "REFUND"]);
  expect(statement.rows.at(-1)).toMatchObject({ sourceId: refundId, debitCents: 3000n, creditCents: 0n });
  expect(await getInvoiceOpenCents(actor, invoiceId)).toBe(6000n);
  expect(await getReceiptOpenCents(actor, receiptId)).toBe(3000n);
  const cash = await getCashMovements(actor, { from: "2026-06-01", to: "2026-06-04", accountId: W.bank });
  expect(cash.totals).toMatchObject({ incomingCents: 10000n, outgoingCents: 3000n, closingCents: 7000n, differenceCents: 0n });
  expect((await getIncomeStatement(actor, { from: "2026-06-01", to: "2026-06-04" })).statement.netIncomeCents).toBe(10000n);
  expect((await db.query("SELECT count(*)::int AS n FROM journal_line WHERE company_id=$1 AND tax_id IS NOT NULL", [W.companyA])).rows[0].n).toBe(0);
});

it("restores cash and receipt availability on reversal while preserving the original dated refund", async () => {
  await voidCustomerRefund(actor, refundId, { date: "2026-06-05", reason: "Recorded twice outside Allumi" });
  await assertControl("2026-06-04", 3000n);
  const statement = await assertControl("2026-06-05", 0n);
  expect(statement.rows.map(row => row.kind)).toEqual(["INVOICE", "RECEIPT", "REFUND", "REVERSAL"]);
  expect(statement.rows.at(-1)).toMatchObject({ sourceId: refundId, debitCents: 0n, creditCents: 3000n });
  expect(await getInvoiceOpenCents(actor, invoiceId)).toBe(6000n);
  expect(await getReceiptOpenCents(actor, receiptId)).toBe(6000n);
  expect((await getCashMovements(actor, { from: "2026-06-01", to: "2026-06-05", accountId: W.bank })).totals).toMatchObject({ closingCents: 10000n, differenceCents: 0n });
  expect((await getIncomeStatement(actor, { from: "2026-06-01", to: "2026-06-05" })).statement.netIncomeCents).toBe(10000n);
  expect((await db.query("SELECT count(*)::int AS n FROM journal_entry WHERE company_id=$1", [W.companyA])).rows[0].n).toBe(4);
});
