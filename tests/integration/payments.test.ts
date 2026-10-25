import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { getReceipt, listInvoicePayments, listReceiptAccounts, listReceipts, recordReceipt, voidReceipt } from "@/modules/payments";
import { getDraft, getInvoice, getInvoiceOpenCents, postCreditNote, postInvoice, saveCreditDraft, saveDraft, getCreditDraft, voidInvoice } from "@/modules/sales";
import { listFiscalYears, lockPeriod } from "@/modules/ledger";
import { AppError } from "@/platform/errors";
import type { CompanyContext } from "@/platform/tenant";
import { owner } from "./helpers";
import { seedWorld, W } from "./world";

const actor = { userId: W.userOwnerA, companyId: W.companyA };
const accountant = { ...actor, userId: W.userAccountant };
const reader = { ...actor, userId: W.userReader };
const otherOwner = { userId: W.userOwnerB, companyId: W.companyB };
// The service refuses a payment dated after today; a fixed clock keeps the tests independent of the day they run.
const NOW = new Date("2026-12-31T12:00:00Z");
const TOTAL = 11498n; // 100,00 $ + GST 5,00 $ + QST 9,98 $

let db: pg.Client;
beforeAll(async () => {
  db = await owner();
  await seedWorld(db);
  await db.query("INSERT INTO number_sequence(company_id,key,next_value,prefix,padding) VALUES ($1,'JOURNAL_ENTRY',1,'J-',5),($1,'INVOICE',1,'F-',5),($1,'CREDIT_NOTE',1,'AV-',5),($1,'PAYMENT_RECEIVED',1,'E-',5)", [W.companyA]);
});
afterAll(async () => { await db?.end(); });

async function invoice(date = "2026-06-01", contactId: string = W.customer) {
  const id = await saveDraft(actor, { contactId, issueDate: date, dueDate: "2026-12-01", lines: [{ description: "Service", quantity: "1", unitPrice: "100", accountId: W.sales, taxCodeId: W.taxCodeStandard }] });
  await postInvoice(actor, id, (await getDraft(actor, id))!.revision, date);
  return id;
}
const open = async (id: string) => (await getInvoiceOpenCents(actor, id))!;

type Over = Partial<{ amountCents: string; expectedOpenCents: string; date: string; accountId: string; method: string; reference: string; memo: string }>;
async function pay(invoiceId: string, over: Over = {}, who: CompanyContext = actor) {
  return recordReceipt(who, {
    invoiceId, amountCents: String(TOTAL), expectedOpenCents: String(await open(invoiceId)), date: "2026-06-15", accountId: W.bank, method: "EFT", ...over,
  }, { now: NOW });
}
async function refusal(promise: Promise<unknown>): Promise<string> {
  try { await promise; } catch (error) { if (error instanceof AppError) return error.key; throw error; }
  throw new Error("expected a refusal");
}
const count = async (sql: string, args: unknown[] = []) => (await db.query(`SELECT count(*)::int AS n FROM ${sql}`, args)).rows[0].n as number;

describe("recording a payment received", () => {
  it("posts the entry, the payment and the allocation together, and settles the invoice", async () => {
    const id = await invoice();
    const receipt = await pay(id, { method: "CHEQUE", reference: "Chèque 1042", memo: "Reçu au comptoir" });
    expect(receipt.number).toMatch(/^E-\d{5}$/);
    expect(await open(id)).toBe(0n);

    const row = (await db.query("SELECT * FROM payment WHERE id = $1", [receipt.id])).rows[0];
    expect(row).toMatchObject({ company_id: W.companyA, direction: "RECEIVED", ledger: "RECEIVABLE", contact_id: W.customer, account_id: W.bank, method: "CHEQUE", reference: "Chèque 1042", memo: "Reçu au comptoir", status: "POSTED", number: receipt.number });
    expect(BigInt(row.amount_cents)).toBe(TOTAL);
    expect(row.payment_date.toISOString().slice(0, 10)).toBe("2026-06-15");
    // money in on the bank, receivables down for the customer: one balanced entry that points back to the payment
    const entry = (await db.query("SELECT source_type, source_id, entry_date::text AS d FROM journal_entry WHERE id = $1", [row.journal_entry_id])).rows[0];
    expect(entry).toMatchObject({ source_type: "PAYMENT", source_id: receipt.id, d: "2026-06-15" });
    const lines = (await db.query("SELECT account_id, debit_cents::text AS debit, credit_cents::text AS credit, contact_id FROM journal_line WHERE entry_id = $1 ORDER BY line_no", [row.journal_entry_id])).rows;
    expect(lines).toEqual([
      { account_id: W.bank, debit: String(TOTAL), credit: "0", contact_id: null },
      { account_id: W.receivable, debit: "0", credit: String(TOTAL), contact_id: W.customer },
    ]);
    const allocation = (await db.query("SELECT payment_id, sales_document_id, amount_cents::text AS cents, applied_date::text AS d, unapplied_date FROM payment_allocation WHERE sales_document_id = $1", [id])).rows;
    expect(allocation).toEqual([{ payment_id: receipt.id, sales_document_id: id, cents: String(TOTAL), d: "2026-06-15", unapplied_date: null }]);

    expect(await listInvoicePayments(reader, id)).toEqual([expect.objectContaining({ paymentId: receipt.id, number: receipt.number, amountCents: TOTAL, method: "CHEQUE", reference: "Chèque 1042", date: "2026-06-15" })]);
    const detail = (await getReceipt(reader, receipt.id))!;
    expect(detail).toMatchObject({ number: receipt.number, status: "POSTED", customer: "Client Fictif", amountCents: TOTAL, journalEntryId: row.journal_entry_id });
    expect(detail.allocations).toEqual([expect.objectContaining({ invoiceId: id, amountCents: TOTAL, unappliedDate: null })]);
  });

  it("takes partial payments in turn and tracks the balance", async () => {
    const id = await invoice();
    await pay(id, { amountCents: "5000" });
    expect(await open(id)).toBe(TOTAL - 5000n);
    // the form drawn before that payment is stale: the balance it showed is gone
    expect(await refusal(pay(id, { amountCents: "1000", expectedOpenCents: String(TOTAL) }))).toBe("payments.stale");
    await pay(id, { amountCents: "1498" });
    expect(await open(id)).toBe(TOTAL - 6498n);
    await pay(id, { amountCents: String(TOTAL - 6498n), date: "2026-07-01" });
    expect(await open(id)).toBe(0n);
    expect(await listInvoicePayments(actor, id)).toHaveLength(3);
    // nothing left to receive
    expect(await refusal(pay(id, { amountCents: "1", expectedOpenCents: "0" }))).toBe("payments.exceeds");
  });

  it("stores a missing reference or memo as NULL, not as an empty string", async () => {
    const id = await invoice();
    const receipt = await pay(id, { amountCents: "100", reference: "   ", memo: "" });
    expect((await db.query("SELECT reference, memo FROM payment WHERE id = $1", [receipt.id])).rows[0]).toEqual({ reference: null, memo: null });
  });

  it("numbers payments without gaps, even when a request is refused", async () => {
    const id = await invoice();
    const first = await pay(id, { amountCents: "1000" });
    expect(await refusal(pay(id, { amountCents: "99999999" }))).toBe("payments.exceeds");
    expect(await refusal(pay(id, { accountId: W.sales, amountCents: "1000" }))).toBe("payments.account");
    const second = await pay(id, { amountCents: "1000" });
    expect(Number(second.number.slice(2)) - Number(first.number.slice(2))).toBe(1);
  });

  it("refuses what cannot be a payment", async () => {
    const id = await invoice();
    const cases: [string, Over, string][] = [
      ["zero", { amountCents: "0" }, "payments.invalid"],
      ["negative", { amountCents: "-5" }, "payments.invalid"],
      ["decimal", { amountCents: "10.50" }, "payments.invalid"],
      ["text", { amountCents: "dix" }, "payments.invalid"],
      ["unknown method", { method: "BITCOIN" }, "payments.invalid"],
      ["bad date", { date: "2026-02-30" }, "payments.invalid"],
      ["too long a reference", { reference: "x".repeat(101) }, "payments.invalid"],
      ["more than the balance", { amountCents: String(TOTAL + 1n) }, "payments.exceeds"],
      ["before the invoice", { date: "2026-05-31" }, "payments.dateBeforeInvoice"],
      ["in the future", { date: "2027-01-01" }, "payments.futureDate"],
      ["a revenue account", { accountId: W.sales }, "payments.account"],
      ["the receivables account", { accountId: W.receivable }, "payments.account"],
      ["another company's bank", { accountId: W.bankB }, "payments.account"],
      ["an unknown account", { accountId: "00000000-0000-7000-8000-0000deadbeef" }, "payments.account"],
    ];
    for (const [label, over, key] of cases) expect(await refusal(pay(id, over)), label).toBe(key);
    expect(await open(id)).toBe(TOTAL);
    expect(await count("payment WHERE company_id = $1 AND id IN (SELECT payment_id FROM payment_allocation WHERE sales_document_id = $2)", [W.companyA, id])).toBe(0);
    // the undeposited funds account is a valid destination
    await pay(id, { accountId: W.undeposited, amountCents: "100" });
  });

  it("refuses an unknown invoice, a draft, a voided invoice and another company's invoice", async () => {
    const draft = await saveDraft(actor, { contactId: W.customer, issueDate: "2026-06-01", dueDate: "2026-12-01", lines: [{ description: "Brouillon", quantity: "1", unitPrice: "10", accountId: W.sales, taxCodeId: W.taxCodeExempt }] });
    expect(await refusal(pay(draft, { expectedOpenCents: "1000" }))).toBe("payments.invoiceNotOpen");
    expect(await refusal(pay("00000000-0000-7000-8000-0000deadbeef", { expectedOpenCents: "1" }))).toBe("payments.invoiceNotFound");
    const voided = await invoice();
    await voidInvoice(actor, voided, "2026-06-20", "Erreur de saisie");
    expect(await refusal(pay(voided, { expectedOpenCents: "0", amountCents: "1" }))).toBe("payments.invoiceNotOpen");
    const mine = await invoice();
    expect(await refusal(pay(mine, {}, otherOwner))).toBe("payments.invoiceNotFound");
    expect(await open(mine)).toBe(TOTAL);
  });

  it("is for owners and accountants; readers only read", async () => {
    const id = await invoice();
    expect(await refusal(pay(id, {}, reader))).toBe("forbidden");
    const receipt = await pay(id, { amountCents: "2000" }, accountant);
    expect((await getReceipt(reader, receipt.id))?.number).toBe(receipt.number);
    expect(await refusal(voidReceipt(reader, receipt.id, { date: "2026-06-20", reason: "Essai" }))).toBe("forbidden");
    expect((await listReceipts(reader)).total).toBeGreaterThan(0);
    // another company sees nothing of it
    expect(await getReceipt(otherOwner, receipt.id)).toBeNull();
    expect((await listReceipts(otherOwner)).total).toBe(0);
    expect(await refusal(voidReceipt(otherOwner, receipt.id, { date: "2026-06-20", reason: "Essai" }))).toBe("payments.notFound");
  });

  it("applies one payment only when the same form is sent several times at once", async () => {
    const id = await invoice();
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => pay(id, { amountCents: "3000", expectedOpenCents: String(TOTAL) })));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    for (const result of results) if (result.status === "rejected") expect((result.reason as AppError).key).toBe("payments.stale");
    expect(await open(id)).toBe(TOTAL - 3000n);
    expect(await count("payment_allocation WHERE sales_document_id = $1", [id])).toBe(1);
  });

  it("never lets two payments exceed the invoice when they race with different reviewed balances", async () => {
    const id = await invoice();
    const results = await Promise.allSettled([
      pay(id, { amountCents: "8000", expectedOpenCents: String(TOTAL) }),
      pay(id, { amountCents: "8000", expectedOpenCents: String(TOTAL - 8000n) }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled").length).toBeLessThanOrEqual(1);
    expect(await open(id)).toBeGreaterThanOrEqual(0n);
  });

  it("leaves a credit note's share alone: only what is still open can be received", async () => {
    const id = await invoice();
    const source = (await getInvoice(actor, id))!;
    const creditId = await saveCreditDraft(actor, id, { issueDate: "2026-07-01", memo: "Rabais", lines: [{ lineId: source.lines[0]!.id, amount: "25" }] });
    const credit = (await getCreditDraft(actor, creditId))!;
    await postCreditNote(actor, creditId, credit.revision, "2026-07-01");
    expect(await open(id)).toBe(8624n);
    expect(await refusal(pay(id, { amountCents: "8625", expectedOpenCents: "8624", date: "2026-07-02" }))).toBe("payments.exceeds");
    await pay(id, { amountCents: "8624", expectedOpenCents: "8624", date: "2026-07-02" });
    expect(await open(id)).toBe(0n);
  });

  it("refuses a date in a locked period", async () => {
    const id = await invoice("2026-03-01");
    const year = (await listFiscalYears(actor)).find((fiscalYear) => fiscalYear.start === "2026-01-01")!;
    await lockPeriod(actor, year.periods.find((period) => period.start === "2026-03-01")!.id);
    expect(await refusal(pay(id, { date: "2026-03-10" }))).toBe("AL003");
    expect(await open(id)).toBe(TOTAL);
    // the open months still work
    await pay(id, { date: "2026-04-10", amountCents: "500" });
  });

  it("is on the audit trail, written by the database", async () => {
    const id = await invoice();
    const receipt = await pay(id, { amountCents: "700" });
    const actions = (await db.query("SELECT action, entity_type FROM audit_log WHERE entity_id = ANY($1::text[]) ORDER BY occurred_at, id", [[receipt.id]])).rows;
    expect(actions).toEqual([{ action: "row.insert", entity_type: "payment" }]);
    expect(await count("audit_log WHERE entity_type = 'payment_allocation' AND after->>'sales_document_id' = $1 AND actor_user_id = $2", [id, W.userOwnerA])).toBe(1);
  });
});

describe("voiding a payment", () => {
  it("reverses the entry, releases the allocation and gives the balance back", async () => {
    const id = await invoice();
    const receipt = await pay(id, { amountCents: "6000" });
    expect(await open(id)).toBe(TOTAL - 6000n);
    await voidReceipt(actor, receipt.id, { date: "2026-06-20", reason: "Chèque sans provision" });
    expect(await open(id)).toBe(TOTAL);

    const row = (await db.query("SELECT status, void_entry_id, void_reason, journal_entry_id, voided_by_id FROM payment WHERE id = $1", [receipt.id])).rows[0];
    expect(row).toMatchObject({ status: "VOID", void_reason: "Chèque sans provision", voided_by_id: W.userOwnerA });
    const reversal = (await db.query("SELECT source_type, reverses_entry_id, entry_date::text AS d, memo FROM journal_entry WHERE id = $1", [row.void_entry_id])).rows[0];
    expect(reversal).toMatchObject({ source_type: "REVERSAL", reverses_entry_id: row.journal_entry_id, d: "2026-06-20", memo: "Chèque sans provision" });
    // bank and receivables are back where they were
    const net = (await db.query(
      `SELECT account_id, sum(debit_cents - credit_cents)::text AS net FROM journal_line WHERE entry_id IN ($1, $2) GROUP BY account_id ORDER BY account_id`,
      [row.journal_entry_id, row.void_entry_id])).rows;
    expect(net.every((line) => line.net === "0")).toBe(true);
    // the allocation is released, never deleted
    expect((await db.query("SELECT unapplied_date::text AS d FROM payment_allocation WHERE payment_id = $1", [receipt.id])).rows).toEqual([{ d: "2026-06-20" }]);

    expect(await listInvoicePayments(actor, id)).toEqual([]);
    const detail = (await getReceipt(actor, receipt.id))!;
    expect(detail).toMatchObject({ status: "VOID", voidReason: "Chèque sans provision", voidDate: "2026-06-20" });
    expect(detail.allocations[0]).toMatchObject({ unappliedDate: "2026-06-20" });
    expect((await listReceipts(actor)).receipts.find((r) => r.id === receipt.id)?.status).toBe("VOID");

    // voiding again changes nothing; the invoice can be paid again
    expect(await voidReceipt(actor, receipt.id, { date: "2026-06-25", reason: "Encore" })).toBe(receipt.id);
    expect(await count("journal_entry WHERE reverses_entry_id = $1", [row.journal_entry_id])).toBe(1);
    await pay(id, { amountCents: String(TOTAL), date: "2026-06-21" });
    expect(await open(id)).toBe(0n);
  });

  it("asks for a reason and a date that does not precede the payment", async () => {
    const id = await invoice();
    const receipt = await pay(id, { amountCents: "1000", date: "2026-06-15" });
    expect(await refusal(voidReceipt(actor, receipt.id, { date: "2026-06-20", reason: "   " }))).toBe("payments.invalidVoid");
    expect(await refusal(voidReceipt(actor, receipt.id, { date: "2026-06-20", reason: "x".repeat(501) }))).toBe("payments.invalidVoid");
    expect(await refusal(voidReceipt(actor, receipt.id, { date: "2026-06-14", reason: "Trop tôt" }))).toBe("payments.invalidVoid");
    expect(await refusal(voidReceipt(actor, receipt.id, { date: "pas une date", reason: "Oups" }))).toBe("payments.invalidVoid");
    expect(await refusal(voidReceipt(actor, "00000000-0000-7000-8000-0000deadbeef", { date: "2026-06-20", reason: "Inconnu" }))).toBe("payments.notFound");
    expect((await db.query("SELECT status FROM payment WHERE id = $1", [receipt.id])).rows[0].status).toBe("POSTED");
    expect(await open(id)).toBe(TOTAL - 1000n);
  });

  it("refuses a void dated in a locked period and leaves everything as it was", async () => {
    const id = await invoice("2026-02-01");
    const receipt = await pay(id, { amountCents: "1000", date: "2026-02-10" });
    const year = (await listFiscalYears(actor)).find((fiscalYear) => fiscalYear.start === "2026-01-01")!;
    await lockPeriod(actor, year.periods.find((period) => period.start === "2026-02-01")!.id);
    expect(await refusal(voidReceipt(actor, receipt.id, { date: "2026-02-12", reason: "Période verrouillée" }))).toBe("AL003");
    expect((await db.query("SELECT status FROM payment WHERE id = $1", [receipt.id])).rows[0].status).toBe("POSTED");
    expect(await open(id)).toBe(TOTAL - 1000n);
    expect(await count("payment_allocation WHERE payment_id = $1 AND unapplied_date IS NULL", [receipt.id])).toBe(1);
    // voided in an open month instead
    await voidReceipt(actor, receipt.id, { date: "2026-04-02", reason: "Corrigé le mois suivant" });
    expect(await open(id)).toBe(TOTAL);
  });

  it("holds the invoice: it cannot be voided while a payment is applied, and can once the payment is voided", async () => {
    const id = await invoice();
    const receipt = await pay(id, { amountCents: "1000" });
    expect(await refusal(voidInvoice(actor, id, "2026-06-30", "Annulation"))).toBe("sales.linked");
    await voidReceipt(actor, receipt.id, { date: "2026-06-20", reason: "Paiement annulé" });
    await voidInvoice(actor, id, "2026-06-30", "Annulation");
    expect((await getInvoice(actor, id))?.status).toBe("VOID");
  });

  it("serializes a void and a new payment on the same invoice", async () => {
    const id = await invoice();
    const receipt = await pay(id, { amountCents: "4000" });
    const results = await Promise.allSettled([
      voidReceipt(actor, receipt.id, { date: "2026-06-20", reason: "Annulé" }),
      pay(id, { amountCents: "500", expectedOpenCents: String(TOTAL - 4000n), date: "2026-06-21" }),
    ]);
    for (const result of results) if (result.status === "rejected") expect(result.reason).toBeInstanceOf(AppError);
    // whatever the order, the books agree: the open balance is the total minus the live allocations
    const live = (await db.query("SELECT coalesce(sum(amount_cents), 0)::text AS n FROM payment_allocation WHERE sales_document_id = $1 AND unapplied_date IS NULL", [id])).rows[0].n;
    expect(await open(id)).toBe(TOTAL - BigInt(live));
  });
});

describe("what the screens offer", () => {
  it("lists the accounts a customer's money can go into", async () => {
    const accounts = await listReceiptAccounts(reader);
    expect(accounts.map((account) => account.id).sort()).toEqual([W.bank, W.undeposited].sort());
  });

  it("pages the payments, newest first", async () => {
    const id = await invoice();
    for (let i = 0; i < 3; i++) await pay(id, { amountCents: "100", date: `2026-08-0${i + 1}` });
    const first = await listReceipts(actor);
    expect(first.page).toBe(1);
    const dates = first.receipts.map((receipt) => receipt.date);
    expect([...dates].sort().reverse()).toEqual(dates);
    expect(first.receipts[0]?.invoices.length).toBeGreaterThanOrEqual(0);
    expect((await listReceipts(actor, 999)).page).toBe(first.pageCount);
  });
});
