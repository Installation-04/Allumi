import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recordReceipt, voidReceipt } from "@/modules/payments";
import { getReceivablesAging } from "@/modules/reports";
import { getCreditDraft, getDraft, getInvoice, postCreditNote, postInvoice, saveCreditDraft, saveDraft, voidInvoice } from "@/modules/sales";
import { AppError } from "@/platform/errors";
import type { CompanyContext } from "@/platform/tenant";
import { owner } from "./helpers";
import { seedWorld, W } from "./world";

const actor: CompanyContext = { userId: W.userOwnerA, companyId: W.companyA };
const accountant: CompanyContext = { ...actor, userId: W.userAccountant };
const reader: CompanyContext = { ...actor, userId: W.userReader };
const otherOwner: CompanyContext = { userId: W.userOwnerB, companyId: W.companyB };
const intruder: CompanyContext = { userId: W.userOwnerB, companyId: W.companyA };
// The service refuses a payment dated after today; a fixed clock keeps the tests independent of the day they run.
const NOW = new Date("2026-12-31T12:00:00Z");
const TOTAL = 11498n; // 100,00 $ + GST 5,00 $ + QST 9,98 $
const CREDIT = 2874n; // 25,00 $ of the same invoice, with its taxes

let db: pg.Client;
let entrySeq = 900_000;
beforeAll(async () => {
  db = await owner();
  await seedWorld(db);
  await db.query("INSERT INTO number_sequence (company_id, key, next_value, prefix, padding) VALUES ($1, 'JOURNAL_ENTRY', 1, 'J-', 5), ($1, 'INVOICE', 1, 'F-', 5), ($1, 'CREDIT_NOTE', 1, 'AV-', 5), ($1, 'PAYMENT_RECEIVED', 1, 'E-', 5), ($2, 'JOURNAL_ENTRY', 1, 'J-', 5)", [W.companyA, W.companyB]);
});
afterAll(async () => { await db?.end(); });

async function refusal(promise: Promise<unknown>): Promise<string> {
  try { await promise; } catch (error) { if (error instanceof AppError) return error.key; throw error; }
  throw new Error("expected a refusal");
}

async function invoice(contactId: string, date: string, dueDate: string, unitPrice = "100"): Promise<string> {
  const id = await saveDraft(actor, { contactId, issueDate: date, dueDate, lines: [{ description: "Service", quantity: "1", unitPrice, accountId: W.sales, taxCodeId: W.taxCodeStandard }] });
  await postInvoice(actor, id, (await getDraft(actor, id))!.revision, date);
  return id;
}

const pay = (invoiceId: string, date: string, amountCents: bigint, openCents: bigint) =>
  recordReceipt(actor, { invoiceId, amountCents: String(amountCents), expectedOpenCents: String(openCents), date, accountId: W.bank, method: "EFT" }, { now: NOW });

/** A payment with its entry and no allocation, written straight in the database (the services always apply a payment to an invoice). */
async function loosePayment(o: { direction: "RECEIVED" | "SENT"; ledger: "RECEIVABLE" | "PAYABLE"; contact: string; date: string; cents: number }): Promise<string> {
  const id = randomUUID();
  const entryId = randomUUID();
  const received = o.direction === "RECEIVED";
  const control = o.ledger === "RECEIVABLE" ? W.receivable : W.payable;
  await db.query("BEGIN");
  try {
    await db.query(
      "INSERT INTO journal_entry (id, company_id, entry_number, entry_date, fiscal_period_id, source_type, source_id, created_by_id) SELECT $1, $2, $3, $4::date, id, 'PAYMENT', $5, $6 FROM fiscal_period WHERE company_id = $2 AND $4::date BETWEEN start_date AND end_date",
      [entryId, W.companyA, ++entrySeq, o.date, id, W.userOwnerA],
    );
    await db.query(
      "INSERT INTO journal_line (id, company_id, entry_id, line_no, account_id, debit_cents, credit_cents, entry_date) VALUES (gen_random_uuid(), $1, $2, 1, $3, $4, $5, $6::date)",
      [W.companyA, entryId, W.bank, received ? o.cents : 0, received ? 0 : o.cents, o.date],
    );
    await db.query(
      "INSERT INTO journal_line (id, company_id, entry_id, line_no, account_id, debit_cents, credit_cents, contact_id, entry_date) VALUES (gen_random_uuid(), $1, $2, 2, $3, $4, $5, $6, $7::date)",
      [W.companyA, entryId, control, received ? 0 : o.cents, received ? o.cents : 0, o.contact, o.date],
    );
    await db.query(
      "INSERT INTO payment (id, company_id, direction, ledger, contact_id, payment_date, amount_cents, account_id, method, journal_entry_id, created_by_id, updated_at) VALUES ($1, $2, $3::payment_direction, $4::payment_ledger, $5, $6::date, $7, $8, 'EFT', $9, $10, now())",
      [id, W.companyA, o.direction, o.ledger, o.contact, o.date, o.cents, W.bank, entryId, W.userOwnerA],
    );
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
  return id;
}

/** What the aging holds for one customer on one day, as the bucket amounts and the not-applied amount. */
async function ofCustomer(who: CompanyContext, asOf: string, name: string) {
  const aging = await getReceivablesAging(who, { asOf });
  const customer = aging.customers.find((entry) => entry.contactName === name);
  return { aging, customer, buckets: customer?.buckets, unapplied: customer?.unappliedCents, total: customer?.totalCents };
}
const empty = { current: 0n, d1_30: 0n, d31_60: 0n, d61_90: 0n, d91_plus: 0n };

const ids = { first: "", second: "", payment: "", loose: "", refund: "" };

describe("the aging as of a day", () => {
  beforeAll(async () => {
    ids.first = await invoice(W.customer, "2026-06-01", "2026-07-01");
    ids.second = await invoice(W.customer, "2026-06-10", "2026-06-20");
    // a partial payment of the first on July 10, a credit note of the second on July 1
    ids.payment = (await pay(ids.first, "2026-07-10", 5_000n, TOTAL)).id;
    const source = (await getInvoice(actor, ids.second))!;
    const credit = await saveCreditDraft(actor, ids.second, { issueDate: "2026-07-01", memo: "Correction", lines: [{ lineId: source.lines[0]!.id, amount: "25" }] });
    await postCreditNote(actor, credit, (await getCreditDraft(actor, credit))!.revision, "2026-07-01");
  });

  it("shows nothing before the first invoice was posted, and a draft never appears", async () => {
    await saveDraft(actor, { contactId: W.customer, issueDate: "2026-05-01", dueDate: "2026-05-31", lines: [{ description: "Brouillon", quantity: "1", unitPrice: "999", accountId: W.sales, taxCodeId: W.taxCodeStandard }] });
    const before = await getReceivablesAging(actor, { asOf: "2026-05-31" });
    expect(before.customers).toEqual([]);
    expect(before.totalCents).toBe(0n);
    expect(before.controlCents).toBe(0n);
    expect(before.differenceCents).toBe(0n);
  });

  it("ages what is open by days past due, on the day itself and either side of each boundary", async () => {
    // June 30: nothing is due yet but the second invoice, 10 days past its due date
    expect(await ofCustomer(actor, "2026-06-30", "Client Fictif")).toMatchObject({ buckets: { ...empty, current: TOTAL, d1_30: TOTAL }, total: 2n * TOTAL });
    // July 1, the first one's due date: due today is still current; the credit note has reduced the second one
    expect(await ofCustomer(actor, "2026-07-01", "Client Fictif")).toMatchObject({ buckets: { ...empty, current: TOTAL, d1_30: TOTAL - CREDIT }, total: 2n * TOTAL - CREDIT });
    // July 2: a day late
    expect(await ofCustomer(actor, "2026-07-02", "Client Fictif")).toMatchObject({ buckets: { ...empty, d1_30: 2n * TOTAL - CREDIT } });
    // 30 days after July 1 is July 31: still in the first bucket; 31 days is August 1
    expect((await ofCustomer(actor, "2026-07-31", "Client Fictif")).buckets).toMatchObject({ d1_30: TOTAL - 5_000n, d31_60: TOTAL - CREDIT });
    expect((await ofCustomer(actor, "2026-08-01", "Client Fictif")).buckets).toMatchObject({ d1_30: 0n, d31_60: 2n * TOTAL - CREDIT - 5_000n });
    // 91 days: September 30 for the first (due July 1), and the second was past 90 long before
    expect(await ofCustomer(actor, "2026-09-30", "Client Fictif")).toMatchObject({ buckets: { ...empty, d91_plus: 2n * TOTAL - CREDIT - 5_000n } });
    expect((await ofCustomer(actor, "2026-09-29", "Client Fictif")).buckets).toMatchObject({ d61_90: TOTAL - 5_000n, d91_plus: TOTAL - CREDIT });
  });

  it("counts a payment or a credit from the day it was applied, not before", async () => {
    expect((await ofCustomer(actor, "2026-07-09", "Client Fictif")).total).toBe(2n * TOTAL - CREDIT);
    expect((await ofCustomer(actor, "2026-07-10", "Client Fictif")).total).toBe(2n * TOTAL - CREDIT - 5_000n);
    expect((await ofCustomer(actor, "2026-06-30", "Client Fictif")).total).toBe(2n * TOTAL);
  });

  it("lists each open invoice with its number, dates and age, oldest due date first", async () => {
    const { customer } = await ofCustomer(actor, "2026-07-31", "Client Fictif");
    expect(customer?.items.map((entry) => [entry.kind, entry.number, entry.date, entry.dueDate, entry.daysPastDue, entry.cents])).toEqual([
      ["INVOICE", "F-00002", "2026-06-10", "2026-06-20", 41, TOTAL - CREDIT],
      ["INVOICE", "F-00001", "2026-06-01", "2026-07-01", 30, TOTAL - 5_000n],
    ]);
  });

  it("drops an invoice that is paid in full or credited in full, and keeps the others", async () => {
    const paid = await invoice(W.otherCustomer, "2026-06-05", "2026-07-05");
    await pay(paid, "2026-07-20", TOTAL, TOTAL);
    expect((await ofCustomer(actor, "2026-07-19", "Autre Client")).total).toBe(TOTAL);
    expect((await ofCustomer(actor, "2026-07-20", "Autre Client")).customer).toBeUndefined();
    expect((await ofCustomer(actor, "2026-12-31", "Autre Client")).customer).toBeUndefined();
  });

  it("brings back, as of the day it was voided, what a voided payment had settled, and not before", async () => {
    await voidReceipt(actor, ids.payment, { date: "2026-07-20", reason: "Chèque sans provision" });
    expect((await ofCustomer(actor, "2026-07-19", "Client Fictif")).total).toBe(2n * TOTAL - CREDIT - 5_000n);
    expect((await ofCustomer(actor, "2026-07-20", "Client Fictif")).total).toBe(2n * TOTAL - CREDIT);
    expect((await ofCustomer(actor, "2026-12-31", "Client Fictif")).total).toBe(2n * TOTAL - CREDIT);
    // the voided payment is not a payment waiting to be applied
    expect((await ofCustomer(actor, "2026-12-31", "Client Fictif")).customer?.items.some((entry) => entry.kind === "PAYMENT")).toBe(false);
  });

  it("keeps an invoice on the days before it was voided, and removes it from the day it was", async () => {
    const mistake = await invoice(W.otherCustomer, "2026-08-03", "2026-08-31", "200");
    await voidInvoice(actor, mistake, "2026-08-10", "Facture en double");
    expect((await ofCustomer(actor, "2026-08-02", "Autre Client")).customer).toBeUndefined();
    expect((await ofCustomer(actor, "2026-08-03", "Autre Client")).total).toBe(22_995n);
    expect((await ofCustomer(actor, "2026-08-09", "Autre Client")).total).toBe(22_995n);
    expect((await ofCustomer(actor, "2026-08-10", "Autre Client")).customer).toBeUndefined();
  });

  it("lists customers by name, and gives the same total whichever way it is added up", async () => {
    await invoice(W.otherCustomer, "2026-09-01", "2026-09-30");
    const aging = await getReceivablesAging(actor, { asOf: "2026-10-31" });
    expect(aging.customers.map((customer) => customer.contactName)).toEqual(["Autre Client", "Client Fictif"]);
    const [other, regular] = aging.customers;
    expect(aging.totalCents).toBe((other?.totalCents ?? 0n) + (regular?.totalCents ?? 0n));
    expect(aging.totalCents).toBe(TOTAL + 2n * TOTAL - CREDIT);
    expect(aging.buckets.d1_30 + aging.buckets.d31_60 + aging.buckets.d61_90 + aging.buckets.d91_plus + aging.buckets.current + aging.unappliedCents).toBe(aging.totalCents);
  });
});

describe("payments and refunds not yet applied", () => {
  const zebra = randomUUID();
  beforeAll(async () => {
    await db.query("INSERT INTO contact (id, company_id, is_customer, display_name, updated_at) VALUES ($1, $2, true, 'Zèbre inc.', now())", [zebra, W.companyA]);
    ids.loose = await loosePayment({ direction: "RECEIVED", ledger: "RECEIVABLE", contact: zebra, date: "2026-11-02", cents: 3_000 });
    ids.refund = await loosePayment({ direction: "SENT", ledger: "RECEIVABLE", contact: zebra, date: "2026-11-05", cents: 1_000 });
    await loosePayment({ direction: "SENT", ledger: "PAYABLE", contact: W.supplier, date: "2026-11-03", cents: 4_000 }); // a supplier's, not a customer's
  });

  it("shows them apart, a payment taking away from what the customer owes and a refund adding to it", async () => {
    const { customer } = await ofCustomer(actor, "2026-11-30", "Zèbre inc.");
    expect(customer?.buckets).toEqual(empty);
    expect(customer?.unappliedCents).toBe(-2_000n);
    expect(customer?.totalCents).toBe(-2_000n);
    expect(customer?.items.map((entry) => [entry.kind, entry.cents, entry.date, entry.bucket])).toEqual([["REFUND", 1_000n, "2026-11-05", null], ["PAYMENT", -3_000n, "2026-11-02", null]]);
  });

  it("holds them from the day they were made only, and leaves a supplier's payment out", async () => {
    expect((await ofCustomer(actor, "2026-11-01", "Zèbre inc.")).customer).toBeUndefined();
    expect((await ofCustomer(actor, "2026-11-02", "Zèbre inc.")).total).toBe(-3_000n);
    expect((await ofCustomer(actor, "2026-11-04", "Zèbre inc.")).total).toBe(-3_000n);
    expect((await ofCustomer(actor, "2026-11-05", "Zèbre inc.")).total).toBe(-2_000n);
    const aging = await getReceivablesAging(actor, { asOf: "2026-11-30" });
    expect(aging.customers.some((customer) => customer.contactName === "Fournisseur Fictif")).toBe(false);
  });

  it("stays out of the figures of a payment that was voided, from the day it was voided", async () => {
    const id = await loosePayment({ direction: "RECEIVED", ledger: "RECEIVABLE", contact: zebra, date: "2026-11-10", cents: 700 });
    const original = (await db.query("SELECT journal_entry_id FROM payment WHERE id = $1", [id])).rows[0].journal_entry_id as string;
    const reversal = randomUUID();
    await db.query("BEGIN");
    try {
      await db.query(
        "INSERT INTO journal_entry (id, company_id, entry_number, entry_date, fiscal_period_id, source_type, reverses_entry_id, created_by_id) SELECT $1, $2, $3, '2026-11-12', id, 'REVERSAL', $4, $5 FROM fiscal_period WHERE company_id = $2 AND '2026-11-12'::date BETWEEN start_date AND end_date",
        [reversal, W.companyA, ++entrySeq, original, W.userOwnerA],
      );
      await db.query(
        "INSERT INTO journal_line (id, company_id, entry_id, line_no, account_id, debit_cents, credit_cents, contact_id, entry_date, tax_id, tax_box) SELECT gen_random_uuid(), l.company_id, $1, l.line_no, l.account_id, l.credit_cents, l.debit_cents, l.contact_id, '2026-11-12'::date, l.tax_id, l.tax_box FROM journal_line l WHERE l.entry_id = $2",
        [reversal, original],
      );
      await db.query("UPDATE payment SET status = 'VOID', void_entry_id = $2, voided_at = now(), voided_by_id = $3, void_reason = 'Essai', updated_at = now() WHERE id = $1", [id, reversal, W.userOwnerA]);
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    }
    expect((await ofCustomer(actor, "2026-11-11", "Zèbre inc.")).total).toBe(-2_700n);
    expect((await ofCustomer(actor, "2026-11-12", "Zèbre inc.")).total).toBe(-2_000n);
  });
});

describe("the check against the ledger", () => {
  it("adds up to the receivable accounts' balance on every day, whatever has happened since", async () => {
    for (const asOf of ["2026-05-31", "2026-06-15", "2026-06-30", "2026-07-01", "2026-07-10", "2026-07-19", "2026-07-20", "2026-08-09", "2026-08-10", "2026-09-30", "2026-10-31", "2026-11-04", "2026-11-11", "2026-11-12", "2026-12-31"]) {
      const aging = await getReceivablesAging(actor, { asOf });
      expect(aging.differenceCents, asOf).toBe(0n);
      expect(aging.controlCents, asOf).toBe(aging.totalCents);
    }
    expect((await getReceivablesAging(actor, { asOf: "2026-12-31" })).controlCents).not.toBe(0n);
  });

  it("shows the difference when the ledger holds an amount on the receivable accounts that no document or payment explains", async () => {
    // The database refuses an entry that claims to be a payment's with no payment behind it; with that check (and the line one that shares it) off for the length of a transaction, it is what the comparison is there to catch.
    const id = randomUUID();
    await db.query("BEGIN");
    try {
      await db.query("ALTER TABLE journal_entry DISABLE TRIGGER journal_entry_complete");
      await db.query("ALTER TABLE journal_line DISABLE TRIGGER journal_line_balanced");
      await db.query(
        "INSERT INTO journal_entry (id, company_id, entry_number, entry_date, fiscal_period_id, source_type, source_id, created_by_id) SELECT $1, $2, $3, '2026-12-01', id, 'PAYMENT', $5, $4 FROM fiscal_period WHERE company_id = $2 AND start_date = '2026-12-01'",
        [id, W.companyA, ++entrySeq, W.userOwnerA, randomUUID()],
      );
      await db.query("INSERT INTO journal_line (id, company_id, entry_id, line_no, account_id, debit_cents, credit_cents, contact_id, entry_date) VALUES (gen_random_uuid(), $1, $2, 1, $3, 1234, 0, $5, '2026-12-01'), (gen_random_uuid(), $1, $2, 2, $4, 0, 1234, NULL, '2026-12-01')", [W.companyA, id, W.receivable, W.sales, W.customer]);
      await db.query("ALTER TABLE journal_entry ENABLE TRIGGER journal_entry_complete");
      await db.query("ALTER TABLE journal_line ENABLE TRIGGER journal_line_balanced");
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    }
    const before = await getReceivablesAging(actor, { asOf: "2026-11-30" });
    const after = await getReceivablesAging(actor, { asOf: "2026-12-01" });
    expect(before.differenceCents).toBe(0n);
    expect(after.differenceCents).toBe(1_234n);
    expect(after.controlCents - after.totalCents).toBe(1_234n);
  });
});

describe("who may read it", () => {
  it("is read by the members who read the ledger and the sales", async () => {
    const expected = (await getReceivablesAging(actor, { asOf: "2026-10-31" })).totalCents;
    expect((await getReceivablesAging(reader, { asOf: "2026-10-31" })).totalCents).toBe(expected);
    expect((await getReceivablesAging(accountant, { asOf: "2026-10-31" })).totalCents).toBe(expected);
  });

  it("is refused to a member whose access to the sales, or to the accounting, is removed", async () => {
    for (const access of ['{"sales":"none"}', '{"accounting":"none"}']) {
      await db.query("UPDATE membership SET module_access = $3::jsonb WHERE company_id = $1 AND user_id = $2", [W.companyA, W.userReader, access]);
      try {
        expect(await refusal(getReceivablesAging(reader, { asOf: "2026-10-31" })), access).toBe("forbidden");
      } finally {
        await db.query("UPDATE membership SET module_access = '{}'::jsonb WHERE company_id = $1 AND user_id = $2", [W.companyA, W.userReader]);
      }
    }
    expect((await getReceivablesAging(reader, { asOf: "2026-10-31" })).customers.length).toBeGreaterThan(0);
  });

  it("is refused to someone who is not a member, and shows another company only its own", async () => {
    expect(await refusal(getReceivablesAging(intruder, { asOf: "2026-10-31" }))).toBe("forbidden");
    const other = await getReceivablesAging(otherOwner, { asOf: "2026-12-31" });
    expect(other.customers).toEqual([]);
    expect(other.controlCents).toBe(0n);
  });

  it("refuses a day that does not exist", async () => {
    for (const asOf of ["2026-02-30", "pas une date", "", "2026-13-01", "2026-1-5"]) expect(await refusal(getReceivablesAging(actor, { asOf })), asOf).toBe("reports.period");
  });
});
