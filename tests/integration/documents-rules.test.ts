import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { owner } from "./helpers";
import { appClient, asOwnerA, entry, inContext, line, seedWorld, sqlstate, W } from "./world";
import type { LineInput } from "./world";

/**
 * Database rules for documents, payments, allocations and deposits (cases T34 to T49 of the phase 1 SQL
 * smoke tests, plus the rules of the triggers that those cases did not reach). Every test runs as the owner of
 * company A through the restricted application role, in a transaction that is rolled back; the deferred
 * checks (postings, allocations, deposits) fire at the end of the transaction exactly like a COMMIT.
 */

let app: pg.Client; // the application role, like the real application
let db: pg.Client; // the table owner (fixtures, and the triggers that guard against it)

beforeAll(async () => {
  db = await owner();
  await seedWorld(db);
  app = await appClient();
});
afterAll(async () => {
  await app.end();
  await db.end();
});

/** Runs `fn` as the owner of company A in a transaction that is checked like a COMMIT, then rolled back. */
const run = <T>(fn: () => Promise<T>): Promise<T> => inContext(app, asOwnerA, fn);
/** The SQLSTATE raised by `fn` run that way (null when it succeeds). */
const code = (fn: () => Promise<unknown>): Promise<string | null> => sqlstate(() => run(fn));
/** Same, on the owner connection (to reach the triggers that back up the privileges of the application role). */
const codeAsTableOwner = (fn: () => Promise<unknown>): Promise<string | null> => sqlstate(() => inContext(db, asOwnerA, fn));

// ---------------------------------------------------------------------------
// Private helpers: TypeScript equivalents of the SQL fixtures t.invoice_draft, t.invoice_post and t.receipt,
// generalized a little (credit notes, bills, every direction of payment) for the added cases.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

async function one<T extends Row>(c: pg.Client, sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await c.query<T>(sql, params);
  const first = rows[0];
  if (!first) throw new Error(`no row returned by: ${sql}`);
  return first;
}
/** A single integer column named n. */
async function int(c: pg.Client, sql: string, params: unknown[] = []): Promise<number> {
  return (await one<{ n: number }>(c, sql, params)).n;
}

// Entry numbers and document numbers are never reused, so a test can be moved or repeated safely.
let entrySeq = 1000;
const nextEntryNo = (): number => ++entrySeq;
let numberSeq = 0;
const nextNumber = (prefix: string): string => `${prefix}-${String(++numberSeq).padStart(4, "0")}`;

/** Fires the deferred checks queued so far, as a COMMIT would, and keeps the transaction open: the state built before behaves as committed earlier. */
async function settle(c: pg.Client): Promise<void> {
  await c.query("SET CONSTRAINTS ALL IMMEDIATE");
  await c.query("SET CONSTRAINTS ALL DEFERRED");
}

const lockPeriod = (c: pg.Client, periodNumber: number) =>
  c.query("UPDATE fiscal_period SET status = 'LOCKED', locked_at = now(), locked_by_id = app_current_user_id() WHERE company_id = app_tenant_id() AND period_number = $1", [periodNumber]);

/** A debit or a credit of `cents`. */
const side = (cents: number, debit: boolean): LineInput => (debit ? { debit: cents } : { credit: cents });

// --- Sales documents ---------------------------------------------------------

type SalesDraftInput = {
  date?: string; // issue and posting date
  issue?: string; // issue date, when it precedes the posting date
  contact?: string;
  cents?: number;
  kind?: "INVOICE" | "CREDIT_NOTE";
  credits?: string;
  rounding?: "PER_LINE" | "PER_DOCUMENT";
};
type PostedSales = { id: string; entry: string; total: number };

/** A draft of `cents` (one line coded GST+QST) whose taxes are exact, not yet posted (t.invoice_draft). */
async function salesDraft(c: pg.Client, d: SalesDraftInput = {}): Promise<string> {
  const id = randomUUID();
  const kind = d.kind ?? "INVOICE";
  const cents = d.cents ?? 10000;
  await c.query(
    `INSERT INTO sales_document (id, company_id, kind, contact_id, issue_date, posting_date, due_date, tax_rounding, credited_document_id, created_by_id, updated_at)
     VALUES ($1, app_tenant_id(), $2::sales_document_kind, $3, $4::date, $5::date, $4::date + $6::int, $7::tax_rounding, $8, app_current_user_id(), now())`,
    [id, kind, d.contact ?? W.customer, d.issue ?? d.date ?? "2026-04-01", d.date ?? "2026-04-01", kind === "INVOICE" ? 30 : null, d.rounding ?? "PER_LINE", d.credits ?? null],
  );
  await c.query(
    `INSERT INTO sales_document_line (id, company_id, document_id, position, description, quantity, unit_price, amount_cents, account_id, tax_code_id)
     VALUES (gen_random_uuid(), app_tenant_id(), $1, 1, 'Service', 1, $2::bigint / 100.0, $2::bigint, $3, $4)`,
    [id, cents, W.sales, W.taxCodeStandard],
  );
  await c.query(
    `INSERT INTO sales_document_tax (id, company_id, document_id, tax_id, rate, base_cents, amount_cents) VALUES
       (gen_random_uuid(), app_tenant_id(), $1, $2, 0.05, $4::bigint, round($4::bigint * 0.05)),
       (gen_random_uuid(), app_tenant_id(), $1, $3, 0.09975, $4::bigint, round($4::bigint * 0.09975))`,
    [id, W.gst, W.qst, cents],
  );
  return id;
}

/**
 * Posts a draft with its exact entry (t.invoice_post). An invoice debits receivables, a credit note credits them.
 * `arContact` lets a test charge the receivables line to someone other than the customer of the document.
 */
async function salesPost(c: pg.Client, id: string, o: { number?: string; arContact?: string; entryDate?: string } = {}): Promise<PostedSales> {
  const doc = await one<{ posting_date: string; contact_id: string; kind: string }>(c, "SELECT posting_date::text AS posting_date, contact_id, kind::text AS kind FROM sales_document WHERE id = $1", [id]);
  const subtotal = await int(c, "SELECT sum(amount_cents)::int AS n FROM sales_document_line WHERE document_id = $1", [id]);
  const gst = await int(c, "SELECT amount_cents::int AS n FROM sales_document_tax WHERE document_id = $1 AND tax_id = $2", [id, W.gst]);
  const qst = await int(c, "SELECT amount_cents::int AS n FROM sales_document_tax WHERE document_id = $1 AND tax_id = $2", [id, W.qst]);
  const total = subtotal + gst + qst;
  const invoice = doc.kind === "INVOICE";
  const entryId = randomUUID();
  await entry(c, { id: entryId, no: nextEntryNo(), date: o.entryDate ?? doc.posting_date, source: "SALES_DOCUMENT", sourceId: id });
  await line(c, entryId, 1, W.receivable, { ...side(total, invoice), contact: o.arContact ?? doc.contact_id });
  await line(c, entryId, 2, W.sales, side(subtotal, !invoice));
  await line(c, entryId, 3, W.gstPayable, { ...side(gst, !invoice), tax: W.gst, box: "COLLECTED" });
  await line(c, entryId, 4, W.qstPayable, { ...side(qst, !invoice), tax: W.qst, box: "COLLECTED" });
  await c.query(
    `UPDATE sales_document SET status = 'POSTED', number = $2, journal_entry_id = $3,
            billing_snapshot = '{"name":"client"}', issuer_snapshot = '{"name":"Atelier Exemple inc."}',
            subtotal_cents = $4::bigint, tax_total_cents = $5::bigint, total_cents = $6::bigint,
            posted_at = now(), posted_by_id = app_current_user_id(), updated_at = now()
      WHERE id = $1`,
    [id, o.number ?? nextNumber(invoice ? "F" : "A"), entryId, subtotal, gst + qst, total],
  );
  return { id, entry: entryId, total };
}

const postedInvoice = async (c: pg.Client, d: SalesDraftInput = {}): Promise<PostedSales> => salesPost(c, await salesDraft(c, d));

// --- Purchase documents ------------------------------------------------------

type PurchaseDraftInput = {
  date?: string;
  contact?: string | null; // null for an expense paid to someone who is not a contact
  cents?: number;
  kind?: "BILL" | "SUPPLIER_CREDIT" | "EXPENSE";
  credits?: string;
  paymentAccount?: string;
  taxCode?: string | null;
  taxes?: boolean; // whether the supplier's tax amounts are recorded
};
type PostedPurchase = { id: string; entry: string; total: number };

/** A draft bill, supplier credit or expense of `cents` before taxes; the taxes are those the supplier charged (all recoverable). */
async function purchaseDraft(c: pg.Client, d: PurchaseDraftInput = {}): Promise<string> {
  const id = randomUUID();
  const kind = d.kind ?? "BILL";
  const cents = d.cents ?? 10000;
  const contact = d.contact === undefined ? (kind === "EXPENSE" ? null : W.supplier) : d.contact;
  await c.query(
    `INSERT INTO purchase_document (id, company_id, kind, contact_id, payee_name, document_date, posting_date, due_date, credited_document_id, tax_rounding, payment_account_id, created_by_id, updated_at)
     VALUES ($1, app_tenant_id(), $2::purchase_document_kind, $3, $4, $5::date, $5::date, $5::date + $6::int, $7, 'PER_LINE', $8, app_current_user_id(), now())`,
    [id, kind, contact, contact === null ? "Corner store" : null, d.date ?? "2026-04-01", kind === "BILL" ? 30 : null, d.credits ?? null, d.paymentAccount ?? (kind === "EXPENSE" ? W.bank : null)],
  );
  await c.query(
    `INSERT INTO purchase_document_line (id, company_id, document_id, position, description, quantity, unit_price, amount_cents, account_id, tax_code_id)
     VALUES (gen_random_uuid(), app_tenant_id(), $1, 1, 'Supplies', 1, $2::bigint / 100.0, $2::bigint, $3, $4)`,
    [id, cents, W.expenses, d.taxCode === undefined ? W.taxCodeStandard : d.taxCode],
  );
  if (d.taxes ?? true) {
    await c.query(
      `INSERT INTO purchase_document_tax (id, company_id, document_id, tax_id, rate, base_cents, amount_cents, recoverable_cents) VALUES
         (gen_random_uuid(), app_tenant_id(), $1, $2, 0.05, $4::bigint, round($4::bigint * 0.05), round($4::bigint * 0.05)),
         (gen_random_uuid(), app_tenant_id(), $1, $3, 0.09975, $4::bigint, round($4::bigint * 0.09975), round($4::bigint * 0.09975))`,
      [id, W.gst, W.qst, cents],
    );
  }
  return id;
}

/**
 * Posts a purchase draft with its entry: a bill debits expenses and recoverable taxes and credits payables, a supplier
 * credit does the opposite, an expense credits the account it was paid from. The overrides make the entry lie.
 */
async function purchasePost(c: pg.Client, id: string, o: { apContact?: string; payable?: number; expense?: number; creditAccount?: string } = {}): Promise<PostedPurchase> {
  const doc = await one<{ posting_date: string; contact_id: string | null; kind: string; payment_account_id: string | null }>(
    c,
    "SELECT posting_date::text AS posting_date, contact_id, kind::text AS kind, payment_account_id FROM purchase_document WHERE id = $1",
    [id],
  );
  const subtotal = await int(c, "SELECT coalesce(sum(amount_cents), 0)::int AS n FROM purchase_document_line WHERE document_id = $1", [id]);
  const gst = await int(c, "SELECT coalesce(sum(amount_cents), 0)::int AS n FROM purchase_document_tax WHERE document_id = $1 AND tax_id = $2", [id, W.gst]);
  const qst = await int(c, "SELECT coalesce(sum(amount_cents), 0)::int AS n FROM purchase_document_tax WHERE document_id = $1 AND tax_id = $2", [id, W.qst]);
  const total = subtotal + gst + qst;
  const debitsExpense = doc.kind !== "SUPPLIER_CREDIT";
  const entryId = randomUUID();
  let no = 0;
  await entry(c, { id: entryId, no: nextEntryNo(), date: doc.posting_date, source: "PURCHASE_DOCUMENT", sourceId: id });
  await line(c, entryId, ++no, W.expenses, side(o.expense ?? subtotal, debitsExpense));
  if (gst > 0) await line(c, entryId, ++no, W.gstReceivable, { ...side(gst, debitsExpense), tax: W.gst, box: "RECOVERABLE" });
  if (qst > 0) await line(c, entryId, ++no, W.qstReceivable, { ...side(qst, debitsExpense), tax: W.qst, box: "RECOVERABLE" });
  if (doc.kind === "EXPENSE") {
    await line(c, entryId, ++no, o.creditAccount ?? doc.payment_account_id ?? W.bank, { credit: o.payable ?? total });
  } else {
    await line(c, entryId, ++no, W.payable, { ...side(o.payable ?? total, !debitsExpense), contact: o.apContact ?? doc.contact_id });
  }
  await c.query(
    `UPDATE purchase_document SET status = 'POSTED', number = $2, journal_entry_id = $3,
            supplier_snapshot = CASE WHEN contact_id IS NULL THEN NULL ELSE '{"name":"supplier"}'::jsonb END,
            subtotal_cents = $4::bigint, tax_total_cents = $5::bigint, total_cents = $6::bigint,
            posted_at = now(), posted_by_id = app_current_user_id(), updated_at = now()
      WHERE id = $1`,
    [id, nextNumber(doc.kind === "BILL" ? "B" : doc.kind === "EXPENSE" ? "D" : "N"), entryId, subtotal, gst + qst, total],
  );
  return { id, entry: entryId, total };
}

const postedBill = async (c: pg.Client, d: PurchaseDraftInput = {}): Promise<PostedPurchase> => purchasePost(c, await purchaseDraft(c, d));

// --- Entries that reverse (voiding) ----------------------------------------------

/** The mirror of an entry: same accounts, contacts and tax tags, debits and credits swapped. */
async function reverse(c: pg.Client, original: string, date: string): Promise<string> {
  const id = randomUUID();
  await entry(c, { id, no: nextEntryNo(), date, source: "REVERSAL", reverses: original });
  await c.query(
    `INSERT INTO journal_line (id, company_id, entry_id, line_no, account_id, debit_cents, credit_cents, contact_id, entry_date, tax_id, tax_box)
     SELECT gen_random_uuid(), l.company_id, $1, l.line_no, l.account_id, l.credit_cents, l.debit_cents, l.contact_id, $2::date, l.tax_id, l.tax_box
       FROM journal_line l WHERE l.entry_id = $3`,
    [id, date, original],
  );
  return id;
}

const voidSales = (c: pg.Client, id: string, voidEntry: string) =>
  c.query(
    "UPDATE sales_document SET status = 'VOID', void_entry_id = $2, voided_at = now(), voided_by_id = app_current_user_id(), void_reason = 'Test', updated_at = now() WHERE id = $1",
    [id, voidEntry],
  );

const voidPurchase = (c: pg.Client, id: string, voidEntry: string) =>
  c.query(
    "UPDATE purchase_document SET status = 'VOID', void_entry_id = $2, voided_at = now(), voided_by_id = app_current_user_id(), void_reason = 'Test', updated_at = now() WHERE id = $1",
    [id, voidEntry],
  );

// --- Payments, allocations, deposits -------------------------------------------

type PaymentInput = {
  date: string;
  entryDate?: string; // when the entry must be dated otherwise than the payment
  contact: string;
  cents: number;
  account: string;
  direction?: "RECEIVED" | "SENT";
  ledger?: "RECEIVABLE" | "PAYABLE";
  status?: "POSTED" | "VOID"; // a payment is created posted; a test may try otherwise
};
type PostedPayment = { id: string; entry: string; cents: number };

/** A posted payment with its entry (t.receipt generalized): RECEIVED debits the account, SENT credits it. */
async function payment(c: pg.Client, p: PaymentInput): Promise<PostedPayment> {
  const id = randomUUID();
  const received = (p.direction ?? "RECEIVED") === "RECEIVED";
  const ledger = p.ledger ?? "RECEIVABLE";
  const entryId = randomUUID();
  await entry(c, { id: entryId, no: nextEntryNo(), date: p.entryDate ?? p.date, source: "PAYMENT", sourceId: id });
  await line(c, entryId, 1, p.account, side(p.cents, received));
  await line(c, entryId, 2, ledger === "RECEIVABLE" ? W.receivable : W.payable, { ...side(p.cents, !received), contact: p.contact });
  await c.query(
    `INSERT INTO payment (id, company_id, direction, ledger, contact_id, payment_date, amount_cents, account_id, method, status, journal_entry_id, created_by_id, updated_at)
     VALUES ($1, app_tenant_id(), $2::payment_direction, $3::payment_ledger, $4, $5::date, $6::bigint, $7, 'EFT', $8::payment_status, $9, app_current_user_id(), now())`,
    [id, p.direction ?? "RECEIVED", ledger, p.contact, p.date, p.cents, p.account, p.status ?? "POSTED", entryId],
  );
  return { id, entry: entryId, cents: p.cents };
}

type AllocationInput = { payment: string; sales?: string; purchase?: string; cents: number; date: string };

async function allocate(c: pg.Client, a: AllocationInput): Promise<string> {
  const id = randomUUID();
  await c.query(
    `INSERT INTO payment_allocation (id, company_id, payment_id, sales_document_id, purchase_document_id, amount_cents, applied_date, created_by_id)
     VALUES ($1, app_tenant_id(), $2, $3, $4, $5::bigint, $6::date, app_current_user_id())`,
    [id, a.payment, a.sales ?? null, a.purchase ?? null, a.cents, a.date],
  );
  return id;
}

const unapplyAllocation = (c: pg.Client, id: string, date: string) =>
  c.query("UPDATE payment_allocation SET unapplied_date = $2::date, unapplied_by_id = app_current_user_id() WHERE id = $1", [id, date]);

const voidPayment = (c: pg.Client, id: string, voidEntry: string) =>
  c.query("UPDATE payment SET status = 'VOID', void_entry_id = $2, voided_at = now(), updated_at = now() WHERE id = $1", [id, voidEntry]);

type DepositInput = { date: string; payments: PostedPayment[]; account?: string; total?: number; entryTotal?: number };
type PostedDeposit = { id: string; entry: string };

/** A deposit of undeposited receipts into a bank account. `total` and `entryTotal` let a test make the header or the entry lie. */
async function deposit(c: pg.Client, d: DepositInput): Promise<PostedDeposit> {
  const id = randomUUID();
  const entryId = randomUUID();
  const itemsTotal = d.payments.reduce((sum, p) => sum + p.cents, 0);
  const total = d.total ?? itemsTotal;
  const entryTotal = d.entryTotal ?? total;
  const account = d.account ?? W.bank;
  await entry(c, { id: entryId, no: nextEntryNo(), date: d.date, source: "DEPOSIT", sourceId: id });
  await line(c, entryId, 1, account, { debit: entryTotal });
  await line(c, entryId, 2, W.undeposited, { credit: entryTotal });
  await c.query(
    `INSERT INTO bank_deposit (id, company_id, account_id, deposit_date, total_cents, journal_entry_id, created_by_id, updated_at)
     VALUES ($1, app_tenant_id(), $2, $3::date, $4::bigint, $5, app_current_user_id(), now())`,
    [id, account, d.date, total, entryId],
  );
  for (const p of d.payments) {
    await c.query("INSERT INTO bank_deposit_item (id, company_id, deposit_id, payment_id) VALUES (gen_random_uuid(), app_tenant_id(), $1, $2)", [id, p.id]);
  }
  return { id, entry: entryId };
}

const voidDeposit = (c: pg.Client, id: string, voidEntry: string) =>
  c.query("UPDATE bank_deposit SET status = 'VOID', void_entry_id = $2, voided_at = now(), voided_by_id = app_current_user_id(), updated_at = now() WHERE id = $1", [id, voidEntry]);

/** A credit note applied to an invoice. */
async function applyCredit(c: pg.Client, a: { creditNote: string; invoice: string; cents: number; date: string }): Promise<void> {
  await c.query(
    `INSERT INTO sales_credit_application (id, company_id, credit_note_id, invoice_id, amount_cents, applied_date, created_by_id)
     VALUES (gen_random_uuid(), app_tenant_id(), $1, $2, $3::bigint, $4::date, app_current_user_id())`,
    [a.creditNote, a.invoice, a.cents, a.date],
  );
}

/** A received payment offset against a sent one (same contact and ledger). */
async function offset(c: pg.Client, o: { received: string; sent: string; cents: number; date: string }): Promise<void> {
  await c.query(
    `INSERT INTO payment_offset (id, company_id, received_payment_id, sent_payment_id, amount_cents, applied_date, created_by_id)
     VALUES (gen_random_uuid(), app_tenant_id(), $1, $2, $3::bigint, $4::date, app_current_user_id())`,
    [o.received, o.sent, o.cents, o.date],
  );
}

/** The state left by T34 and T41: a posted invoice (11 498) and a 5 000 receipt into undeposited funds allocated to it. */
async function allocatedReceipt(c: pg.Client): Promise<{ invoice: PostedSales; receipt: PostedPayment; allocation: string }> {
  const invoice = await postedInvoice(c);
  const receipt = await payment(c, { date: "2026-04-10", contact: W.customer, cents: 5000, account: W.undeposited });
  const allocation = await allocate(c, { payment: receipt.id, sales: invoice.id, cents: 5000, date: "2026-04-10" });
  return { invoice, receipt, allocation };
}

const invoiceOpen = (c: pg.Client, id: string, asOf: string | null = null) =>
  int(c, "SELECT sales_document_open_cents(app_tenant_id(), $1, $2::date)::int AS n", [id, asOf]);
const paymentOpen = (c: pg.Client, id: string) => int(c, "SELECT payment_open_cents(app_tenant_id(), $1)::int AS n", [id]);
const billOpen = (c: pg.Client, id: string) => int(c, "SELECT purchase_document_open_cents(app_tenant_id(), $1)::int AS n", [id]);

// ---------------------------------------------------------------------------
// T34 to T40: invoices, taxes, line amounts, frozen documents
// ---------------------------------------------------------------------------

describe("invoices: exact taxes and amounts", () => {
  it("T34 posts an invoice with exact taxes", async () => {
    await run(async () => {
      const invoice = await postedInvoice(app);
      expect(await one(app, "SELECT status::text AS status, subtotal_cents::int AS subtotal, tax_total_cents::int AS taxes, total_cents::int AS total FROM sales_document WHERE id = $1", [invoice.id])).toEqual({
        status: "POSTED",
        subtotal: 10000,
        taxes: 1498, // 5% = 500 and 9.975% = 997.5 rounded half away from zero = 998
        total: 11498,
      });
      expect(await int(app, "SELECT entry_net_cents(app_tenant_id(), $1, ARRAY['ACCOUNTS_RECEIVABLE']::account_subtype[])::int AS n", [invoice.entry])).toBe(11498);
    });
  });

  it("T35 rejects an invoice with a wrong tax rate (AL005)", async () => {
    expect(
      await code(async () => {
        const id = await salesDraft(app);
        await app.query("UPDATE sales_document_tax SET rate = 0.07, amount_cents = 700 WHERE document_id = $1 AND tax_id = $2", [id, W.gst]);
        await salesPost(app, id); // the same posting as T34, with taxes that are not those of the effective rate
      }),
    ).toBe("AL005");
  });

  it("T36 rejects an invoice entry that charges another customer (AL006)", async () => {
    // The document is changed to another customer after the draft; the receivables line is charged to either one.
    const post = (arContact: string) => async () => {
      const id = await salesDraft(app);
      await app.query("UPDATE sales_document SET contact_id = $2, updated_at = now() WHERE id = $1", [id, W.otherCustomer]);
      await salesPost(app, id, { arContact });
    };
    await run(post(W.otherCustomer)); // control: charged to the customer of the document
    expect(await code(post(W.customer))).toBe("AL006");
  });

  it("T37 requires a line amount equal to round(quantity x unit price)", async () => {
    const addLine = (cents: number) => async () => {
      const id = await salesDraft(app);
      await app.query(
        `INSERT INTO sales_document_line (id, company_id, document_id, position, description, quantity, unit_price, amount_cents, account_id)
         VALUES (gen_random_uuid(), app_tenant_id(), $1, 2, 'Rounding', 3, 0.125, $2::bigint, $3)`,
        [id, cents, W.sales],
      );
    };
    await run(addLine(38)); // control: 3 x 0.125 = 37.5 cents, rounded half away from zero
    expect(await code(addLine(37))).toBe("23514");
  });

  it("T38 rejects a document line on the receivables account (AL005)", async () => {
    const addLine = (account: string) => async () => {
      const id = await salesDraft(app);
      await app.query(
        `INSERT INTO sales_document_line (id, company_id, document_id, position, description, quantity, unit_price, amount_cents, account_id)
         VALUES (gen_random_uuid(), app_tenant_id(), $1, 2, 'Wrong account', 1, 1, 100, $2)`,
        [id, account],
      );
    };
    await run(addLine(W.sales)); // control: a revenue account takes document lines
    expect(await code(addLine(W.receivable))).toBe("AL005");
  });

  it("T39 rejects editing a posted invoice (AL006)", async () => {
    const edit = (post: boolean) => async () => {
      const id = await salesDraft(app);
      if (post) await salesPost(app, id);
      await app.query("UPDATE sales_document_line SET description = 'Edited' WHERE document_id = $1", [id]);
    };
    await run(edit(false)); // control: a draft stays editable
    expect(await code(edit(true))).toBe("AL006");
  });

  it("T40 rejects deleting a posted invoice (AL006)", async () => {
    const remove = (post: boolean) => async () => {
      const id = await salesDraft(app);
      if (post) await salesPost(app, id);
      await app.query("DELETE FROM sales_document WHERE id = $1", [id]);
    };
    await run(remove(false)); // control: a draft can be deleted
    expect(await code(remove(true))).toBe("AL006");
  });
});

// ---------------------------------------------------------------------------
// T41 to T49: payments, allocations, deposits
// ---------------------------------------------------------------------------

describe("receipts and allocations", () => {
  it("T41 allocates a receipt into undeposited funds to the invoice", async () => {
    await run(async () => {
      const { invoice, receipt } = await allocatedReceipt(app);
      expect(await invoiceOpen(app, invoice.id)).toBe(6498);
      expect(await paymentOpen(app, receipt.id)).toBe(0);
    });
  });

  it("T42 rejects a payment entry that credits revenue instead of receivables (AL006)", async () => {
    const receive = (creditAccount: string, contact: string | null) => async () => {
      const id = randomUUID();
      const entryId = randomUUID();
      await entry(app, { id: entryId, no: nextEntryNo(), date: "2026-04-11", source: "PAYMENT", sourceId: id });
      await line(app, entryId, 1, W.bank, { debit: 3000 });
      await line(app, entryId, 2, creditAccount, { credit: 3000, contact });
      await app.query(
        `INSERT INTO payment (id, company_id, direction, ledger, contact_id, payment_date, amount_cents, account_id, method, journal_entry_id, created_by_id, updated_at)
         VALUES ($1, app_tenant_id(), 'RECEIVED', 'RECEIVABLE', $2, '2026-04-11', 3000, $3, 'EFT', $4, app_current_user_id(), now())`,
        [id, W.customer, W.bank, entryId],
      );
    };
    await run(receive(W.receivable, W.customer)); // control: the receipt credits receivables
    expect(await code(receive(W.sales, null))).toBe("AL006");
  });

  it("T43 never deletes allocations (privilege)", async () => {
    expect(
      await code(async () => {
        await allocatedReceipt(app); // there is something to delete
        await app.query("DELETE FROM payment_allocation");
      }),
    ).toBe("42501");
  });

  it("T44 rejects an allocation above the open balance of the invoice (AL007)", async () => {
    const allocateMore = (cents: number) => async () => {
      const { invoice } = await allocatedReceipt(app); // 6 498 remain open
      const receipt = await payment(app, { date: "2026-04-12", contact: W.customer, cents: 20000, account: W.bank });
      await allocate(app, { payment: receipt.id, sales: invoice.id, cents, date: "2026-04-12" });
    };
    await run(allocateMore(6498)); // control: exactly the open balance
    expect(await code(allocateMore(20000))).toBe("AL007");
  });
});

describe("deposits", () => {
  it("T45 deposits the undeposited receipt", async () => {
    await run(async () => {
      const { receipt } = await allocatedReceipt(app);
      const dep = await deposit(app, { date: "2026-04-15", payments: [receipt] });
      expect(await one(app, "SELECT status::text AS status, total_cents::int AS total FROM bank_deposit WHERE id = $1", [dep.id])).toEqual({ status: "POSTED", total: 5000 });
      expect(await int(app, "SELECT count(*)::int AS n FROM bank_deposit_item WHERE deposit_id = $1", [dep.id])).toBe(1);
    });
  });

  it("T46 rejects depositing the same receipt twice (AL010)", async () => {
    expect(
      await code(async () => {
        const { receipt } = await allocatedReceipt(app);
        await deposit(app, { date: "2026-04-15", payments: [receipt] }); // as in T45
        await deposit(app, { date: "2026-04-16", payments: [receipt] });
      }),
    ).toBe("AL010");
  });
});

describe("voiding and unapplying", () => {
  it("T47 rejects voiding a deposited receipt until its deposit is voided (AL006)", async () => {
    // The allocation is unapplied and the void entry mirrors the receipt in both runs: only the deposit differs.
    const voidReceipt = (voidDepositFirst: boolean) => async () => {
      const { receipt, allocation } = await allocatedReceipt(app);
      const dep = await deposit(app, { date: "2026-04-15", payments: [receipt] });
      await settle(app);
      await unapplyAllocation(app, allocation, "2026-04-20");
      if (voidDepositFirst) await voidDeposit(app, dep.id, await reverse(app, dep.entry, "2026-04-20"));
      await voidPayment(app, receipt.id, await reverse(app, receipt.entry, "2026-04-20"));
    };
    await run(voidReceipt(true));
    expect(await code(voidReceipt(false))).toBe("AL006");
  });

  it("T48 rejects unapplying an allocation inside a locked period (AL003)", async () => {
    expect(
      await code(async () => {
        const { allocation } = await allocatedReceipt(app);
        await settle(app); // the allocation exists as if committed earlier
        await lockPeriod(app, 4);
        await unapplyAllocation(app, allocation, "2026-04-25");
      }),
    ).toBe("AL003"); // the control is T49: the same unapplication dated in an open period
  });

  it("T49 unapplies in an open period and keeps the history", async () => {
    await run(async () => {
      const { invoice, receipt, allocation } = await allocatedReceipt(app);
      await settle(app);
      await lockPeriod(app, 4);
      await unapplyAllocation(app, allocation, "2026-05-02");
      // As of the end of April the invoice still shows the receipt; today it does not.
      expect(await invoiceOpen(app, invoice.id, "2026-04-30")).toBe(6498);
      expect(await invoiceOpen(app, invoice.id)).toBe(11498);
      expect(await paymentOpen(app, receipt.id)).toBe(5000);
      expect(await one(app, "SELECT applied_date::text AS applied, unapplied_date::text AS unapplied FROM payment_allocation WHERE id = $1", [allocation])).toEqual({ applied: "2026-04-10", unapplied: "2026-05-02" });
    });
  });
});

// ---------------------------------------------------------------------------
// Added cases: rules of the triggers that the phase 1 SQL cases did not reach
// ---------------------------------------------------------------------------

describe("sales documents are created as drafts and follow their status transitions", () => {
  it("creates a draft, never a document already posted or void (AL006)", async () => {
    const insert = (status: string) => async () => {
      await app.query(
        `INSERT INTO sales_document (id, company_id, kind, status, contact_id, issue_date, posting_date, tax_rounding, created_by_id, updated_at)
         VALUES ($1, app_tenant_id(), 'INVOICE', $2::document_status, $3, '2026-04-01', '2026-04-01', 'PER_LINE', app_current_user_id(), now())`,
        [randomUUID(), status, W.customer],
      );
    };
    await run(insert("DRAFT"));
    for (const status of ["POSTED", "VOID"]) expect(await code(insert(status))).toBe("AL006");
  });

  const salesDocumentIn = async (state: "DRAFT" | "POSTED" | "VOID"): Promise<string> => {
    const id = await salesDraft(app);
    if (state === "DRAFT") return id;
    const posted = await salesPost(app, id);
    if (state === "VOID") await voidSales(app, id, await reverse(app, posted.entry, "2026-04-20"));
    return id;
  };
  it("follows DRAFT -> POSTED -> VOID", async () => {
    await run(async () => {
      const statusOf = async (id: string) => (await one<{ status: string }>(app, "SELECT status::text AS status FROM sales_document WHERE id = $1", [id])).status;
      const id = await salesDraft(app);
      expect(await statusOf(id)).toBe("DRAFT");
      const posted = await salesPost(app, id);
      expect(await statusOf(id)).toBe("POSTED");
      await voidSales(app, id, await reverse(app, posted.entry, "2026-04-20"));
      expect(await statusOf(id)).toBe("VOID");
    });
  });

  it.each([
    ["DRAFT", "VOID"],
    ["POSTED", "DRAFT"],
    ["VOID", "POSTED"],
    ["VOID", "DRAFT"],
  ] as const)("rejects the status transition %s -> %s (AL006)", async (from, to) => {
    // The valid transitions (DRAFT -> POSTED in T34, POSTED -> VOID below) are the controls.
    expect(
      await code(async () => {
        const id = await salesDocumentIn(from);
        await app.query("UPDATE sales_document SET status = $2::document_status, updated_at = now() WHERE id = $1", [id, to]);
      }),
    ).toBe("AL006");
  });

  it("rejects a posted invoice that is edited in its header, taxes or lines, which a draft allows (AL006)", async () => {
    const statements = {
      "header": "UPDATE sales_document SET memo = 'Changed', updated_at = now() WHERE id = $1",
      "tax": "UPDATE sales_document_tax SET amount_cents = 1 WHERE document_id = $1",
      "added line": `INSERT INTO sales_document_line (id, company_id, document_id, position, description, quantity, unit_price, amount_cents, account_id)
                     VALUES (gen_random_uuid(), app_tenant_id(), $1, 2, 'Added', 1, 1, 100, '${W.sales}')`,
      "removed line": "DELETE FROM sales_document_line WHERE document_id = $1",
      "removed tax": "DELETE FROM sales_document_tax WHERE document_id = $1",
    };
    for (const [part, sql] of Object.entries(statements)) {
      const change = (post: boolean) => async () => {
        const id = await salesDraft(app);
        if (post) await salesPost(app, id);
        await app.query(sql, [id]);
      };
      await run(change(false)); // control: the draft accepts it
      expect(await code(change(true)), part).toBe("AL006");
    }
  });

  it("rejects changing the kind of a draft, which still lets its memo change (AL006)", async () => {
    const update = (sql: string) => async () => app.query(sql, [await salesDraft(app)]);
    await run(update("UPDATE sales_document SET memo = 'Note', updated_at = now() WHERE id = $1"));
    expect(await code(update("UPDATE sales_document SET kind = 'CREDIT_NOTE', updated_at = now() WHERE id = $1"))).toBe("AL006");
  });

  it("rejects moving a line to another document (AL006)", async () => {
    const update = (move: boolean) => async () => {
      const first = await salesDraft(app);
      const second = await salesDraft(app);
      if (move) await app.query("UPDATE sales_document_line SET document_id = $2 WHERE document_id = $1", [first, second]);
      else await app.query("UPDATE sales_document_line SET description = 'Renamed' WHERE document_id = $1", [first]);
    };
    await run(update(false));
    expect(await code(update(true))).toBe("AL006");
  });

  it("deletes a draft together with its lines and taxes", async () => {
    await run(async () => {
      const id = await salesDraft(app);
      await app.query("DELETE FROM sales_document WHERE id = $1", [id]);
      expect(await int(app, "SELECT ((SELECT count(*) FROM sales_document_line WHERE document_id = $1) + (SELECT count(*) FROM sales_document_tax WHERE document_id = $1))::int AS n", [id])).toBe(0);
    });
  });
});

describe("a sales document and its entry belong together", () => {
  it("rejects posting a document without an entry (AL006)", async () => {
    expect(
      await code(async () => {
        const id = await salesDraft(app);
        await app.query("UPDATE sales_document SET status = 'POSTED', number = 'F-9001', updated_at = now() WHERE id = $1", [id]);
      }),
    ).toBe("AL006");
  });

  it("rejects posting a document with the entry of another document (AL006)", async () => {
    expect(
      await code(async () => {
        const other = await postedInvoice(app);
        const id = await salesDraft(app);
        await app.query("UPDATE sales_document SET status = 'POSTED', number = 'F-9002', journal_entry_id = $2, updated_at = now() WHERE id = $1", [id, other.entry]);
      }),
    ).toBe("AL006");
  });

  it("rejects a posting entry that is not dated on the posting date (AL006)", async () => {
    const post = (entryDate: string) => async () => salesPost(app, await salesDraft(app), { entryDate });
    await run(post("2026-04-01")); // control: dated on the posting date
    expect(await code(post("2026-04-02"))).toBe("AL006");
  });

  it.each([
    ["SALES_DOCUMENT", "AL006"],
    ["PURCHASE_DOCUMENT", "AL006"],
    ["PAYMENT", "AL006"],
    ["DEPOSIT", "AL010"],
  ] as const)("rejects an entry of source %s whose source does not exist (%s)", async (source, expected) => {
    const post = (kind: string) => async () => {
      const id = randomUUID();
      await entry(app, { id, no: nextEntryNo(), date: "2026-04-01", source: kind, sourceId: kind === "MANUAL" ? null : randomUUID() });
      await line(app, id, 1, W.bank, { debit: 100 });
      await line(app, id, 2, W.capital, { credit: 100 });
    };
    await run(post("MANUAL")); // control: the same lines as a manual entry
    expect(await code(post(source))).toBe(expected);
  });

  it("posts into the period of the posting date, not of the issue date", async () => {
    // March is locked; an invoice issued in March may still be posted in April, but not in March.
    const post = (posting: string) => async () => {
      await lockPeriod(app, 3);
      await postedInvoice(app, { issue: "2026-03-15", date: posting });
    };
    await run(post("2026-04-01"));
    expect(await code(post("2026-03-20"))).toBe("AL003");
  });

  it("applies the tax rounding mode frozen on the document", async () => {
    // Two lines of 3.33: GST is 17 + 17 = 34 rounded per line but 33 rounded on the document; QST is 66 either way.
    const post = (rounding: "PER_LINE" | "PER_DOCUMENT", gst: number) => async () => {
      const id = await salesDraft(app, { cents: 333, rounding });
      await app.query(
        `INSERT INTO sales_document_line (id, company_id, document_id, position, description, quantity, unit_price, amount_cents, account_id, tax_code_id)
         VALUES (gen_random_uuid(), app_tenant_id(), $1, 2, 'Second', 1, 3.33, 333, $2, $3)`,
        [id, W.sales, W.taxCodeStandard],
      );
      await app.query("UPDATE sales_document_tax SET base_cents = 666, amount_cents = $3::bigint WHERE document_id = $1 AND tax_id = $2", [id, W.gst, gst]);
      await app.query("UPDATE sales_document_tax SET base_cents = 666, amount_cents = 66 WHERE document_id = $1 AND tax_id = $2", [id, W.qst]);
      await salesPost(app, id);
    };
    await run(post("PER_LINE", 34));
    await run(post("PER_DOCUMENT", 33));
    expect(await code(post("PER_LINE", 33))).toBe("AL005");
    expect(await code(post("PER_DOCUMENT", 34))).toBe("AL005");
  });
});

describe("invoice lines and their tax codes", () => {
  it("rejects an invoice line without a tax code (AL005)", async () => {
    const post = (taxCode: string | null) => async () => {
      const id = await salesDraft(app);
      await app.query(
        `INSERT INTO sales_document_line (id, company_id, document_id, position, description, quantity, unit_price, amount_cents, account_id, tax_code_id)
         VALUES (gen_random_uuid(), app_tenant_id(), $1, 2, 'Extra', 1, 5, 500, $2, $3)`,
        [id, W.sales, taxCode],
      );
      await salesPost(app, id);
    };
    await run(post(W.taxCodeExempt)); // control: an exempt code adds no tax
    expect(await code(post(null))).toBe("AL005");
  });
});

describe("voiding a sales document", () => {
  it("voids a posted invoice with the reversal of its entry", async () => {
    await run(async () => {
      const invoice = await postedInvoice(app);
      const reversal = await reverse(app, invoice.entry, "2026-04-20");
      await voidSales(app, invoice.id, reversal);
      expect(await one(app, "SELECT status::text AS status, void_entry_id AS reversal FROM sales_document WHERE id = $1", [invoice.id])).toEqual({ status: "VOID", reversal });
      expect(
        await int(
          app,
          `SELECT coalesce(sum(l.debit_cents - l.credit_cents), 0)::int AS n FROM journal_line l JOIN account a ON a.id = l.account_id
            WHERE a.subtype = 'ACCOUNTS_RECEIVABLE' AND l.entry_id IN ($1, $2)`,
          [invoice.entry, reversal],
        ),
      ).toBe(0);
    });
  });

  it("rejects a void entry that does not reverse the posting entry (AL006)", async () => {
    const voidWith = (ownEntry: boolean) => async () => {
      const invoice = await postedInvoice(app);
      const other = await postedInvoice(app);
      await voidSales(app, invoice.id, await reverse(app, ownEntry ? invoice.entry : other.entry, "2026-04-20"));
    };
    await run(voidWith(true));
    expect(await code(voidWith(false))).toBe("AL006");
  });

  it("rejects voiding an invoice while a payment is still allocated to it (AL006)", async () => {
    const voidInvoice = (unapplyFirst: boolean) => async () => {
      const { invoice, allocation } = await allocatedReceipt(app);
      await settle(app);
      if (unapplyFirst) await unapplyAllocation(app, allocation, "2026-04-20");
      await voidSales(app, invoice.id, await reverse(app, invoice.entry, "2026-04-20"));
    };
    await run(voidInvoice(true));
    expect(await code(voidInvoice(false))).toBe("AL006");
  });

  it("rejects voiding an invoice while a posted credit note corrects it (AL006)", async () => {
    const voidInvoice = (voidCreditNoteFirst: boolean) => async () => {
      const invoice = await postedInvoice(app);
      const credit = await postedInvoice(app, { kind: "CREDIT_NOTE", cents: 3000, credits: invoice.id, date: "2026-04-05" });
      if (voidCreditNoteFirst) await voidSales(app, credit.id, await reverse(app, credit.entry, "2026-04-20"));
      await voidSales(app, invoice.id, await reverse(app, invoice.entry, "2026-04-20"));
    };
    await run(voidInvoice(true));
    expect(await code(voidInvoice(false))).toBe("AL006");
  });
});

describe("the entry of a document, payment or deposit is reversed only by voiding it", () => {
  type Subject = { entry: string; voidWith: (reversal: string) => Promise<unknown> };
  const subjects: Record<"invoice" | "bill" | "receipt" | "deposit", () => Promise<Subject>> = {
    invoice: async () => {
      const d = await postedInvoice(app);
      return { entry: d.entry, voidWith: (reversal) => voidSales(app, d.id, reversal) };
    },
    bill: async () => {
      const d = await postedBill(app);
      return { entry: d.entry, voidWith: (reversal) => voidPurchase(app, d.id, reversal) };
    },
    receipt: async () => {
      const d = await payment(app, { date: "2026-04-10", contact: W.customer, cents: 5000, account: W.bank });
      return { entry: d.entry, voidWith: (reversal) => voidPayment(app, d.id, reversal) };
    },
    deposit: async () => {
      const d = await deposit(app, { date: "2026-04-15", payments: [await payment(app, { date: "2026-04-10", contact: W.customer, cents: 5000, account: W.undeposited })] });
      return { entry: d.entry, voidWith: (reversal) => voidDeposit(app, d.id, reversal) };
    },
  };
  it.each(["invoice", "bill", "receipt", "deposit"] as const)("rejects reversing the entry of the %s without voiding it (AL008)", async (kind) => {
    const reverseIt = (andVoid: boolean) => async () => {
      const subject = await subjects[kind]();
      const reversal = await reverse(app, subject.entry, "2026-04-20");
      if (andVoid) await subject.voidWith(reversal);
    };
    await run(reverseIt(true));
    expect(await code(reverseIt(false))).toBe("AL008");
  });
});

describe("credit notes", () => {
  it("posts a credit note that references a posted invoice of the same customer", async () => {
    await run(async () => {
      const invoice = await postedInvoice(app);
      const credit = await postedInvoice(app, { kind: "CREDIT_NOTE", cents: 3000, credits: invoice.id, date: "2026-04-05" });
      expect(credit.total).toBe(3449); // 3 000 + 150 + 299
      expect(await int(app, "SELECT entry_net_cents(app_tenant_id(), $1, ARRAY['ACCOUNTS_RECEIVABLE']::account_subtype[])::int AS n", [credit.entry])).toBe(-3449);
    });
  });

  it("rejects a credit note that references an invoice not yet posted (AL006)", async () => {
    expect(
      await code(async () => {
        const draft = await salesDraft(app);
        await postedInvoice(app, { kind: "CREDIT_NOTE", cents: 3000, credits: draft, date: "2026-04-05" });
      }),
    ).toBe("AL006");
  });

  it("rejects a credit note that references an invoice of another customer (AL006)", async () => {
    expect(
      await code(async () => {
        const invoice = await postedInvoice(app, { contact: W.otherCustomer });
        await postedInvoice(app, { kind: "CREDIT_NOTE", cents: 3000, credits: invoice.id, date: "2026-04-05", contact: W.customer });
      }),
    ).toBe("AL006");
  });

  it("rejects a credit note that references another credit note (AL006)", async () => {
    expect(
      await code(async () => {
        const invoice = await postedInvoice(app);
        const credit = await postedInvoice(app, { kind: "CREDIT_NOTE", cents: 3000, credits: invoice.id, date: "2026-04-05" });
        await postedInvoice(app, { kind: "CREDIT_NOTE", cents: 1000, credits: credit.id, date: "2026-04-06" });
      }),
    ).toBe("AL006");
  });

  it("rejects an invoice that references a credited document (23514)", async () => {
    expect(
      await code(async () => {
        const invoice = await postedInvoice(app);
        await salesDraft(app, { credits: invoice.id }); // kind INVOICE
      }),
    ).toBe("23514");
  });

  it("applies a credit note to an invoice of the same customer, lowering both open balances", async () => {
    await run(async () => {
      const invoice = await postedInvoice(app);
      const credit = await postedInvoice(app, { kind: "CREDIT_NOTE", cents: 3000, credits: invoice.id, date: "2026-04-05" });
      await applyCredit(app, { creditNote: credit.id, invoice: invoice.id, cents: 3449, date: "2026-04-06" });
      expect(await invoiceOpen(app, invoice.id)).toBe(11498 - 3449);
      expect(await invoiceOpen(app, credit.id)).toBe(0);
    });
  });

  it("rejects applying more than the open balance of the credit note (AL007)", async () => {
    const apply = (cents: number) => async () => {
      const invoice = await postedInvoice(app);
      const credit = await postedInvoice(app, { kind: "CREDIT_NOTE", cents: 3000, credits: invoice.id, date: "2026-04-05" });
      await applyCredit(app, { creditNote: credit.id, invoice: invoice.id, cents, date: "2026-04-06" });
    };
    await run(apply(3449));
    expect(await code(apply(3450))).toBe("AL007");
  });

  it("rejects applying a credit note to an invoice of another customer (AL007)", async () => {
    expect(
      await code(async () => {
        const invoice = await postedInvoice(app, { contact: W.customer });
        const credit = await postedInvoice(app, { kind: "CREDIT_NOTE", cents: 3000, credits: invoice.id, date: "2026-04-05" });
        const other = await postedInvoice(app, { contact: W.otherCustomer });
        await applyCredit(app, { creditNote: credit.id, invoice: other.id, cents: 1000, date: "2026-04-06" });
      }),
    ).toBe("AL007");
  });

  it("rejects applying an invoice as if it were a credit note (AL007)", async () => {
    expect(
      await code(async () => {
        const first = await postedInvoice(app);
        const second = await postedInvoice(app);
        await applyCredit(app, { creditNote: first.id, invoice: second.id, cents: 1000, date: "2026-04-06" });
      }),
    ).toBe("AL007");
  });
});

describe("bills, supplier credits and expenses (payable side)", () => {
  it("posts a bill: payables credited to the supplier, recoverable taxes debited", async () => {
    await run(async () => {
      const bill = await postedBill(app);
      expect(bill.total).toBe(11498);
      expect(await one(app, "SELECT status::text AS status, subtotal_cents::int AS subtotal, tax_total_cents::int AS taxes FROM purchase_document WHERE id = $1", [bill.id])).toEqual({ status: "POSTED", subtotal: 10000, taxes: 1498 });
      expect(await int(app, "SELECT entry_net_cents(app_tenant_id(), $1, ARRAY['ACCOUNTS_PAYABLE']::account_subtype[])::int AS n", [bill.entry])).toBe(-11498);
      expect(await billOpen(app, bill.id)).toBe(11498);
    });
  });

  it("rejects a bill entry that charges another supplier (AL006)", async () => {
    const post = (apContact: string) => async () => purchasePost(app, await purchaseDraft(app), { apContact });
    await run(post(W.supplier));
    expect(await code(post(W.customer))).toBe("AL006");
  });

  it("rejects a bill entry whose payable differs from the total of the bill (AL006)", async () => {
    // Balanced (9 502 + 500 + 998 = 11 000) but it records 11 000 as payable instead of 11 498.
    expect(await code(async () => purchasePost(app, await purchaseDraft(app), { expense: 9502, payable: 11000 }))).toBe("AL006");
  });

  it("rejects a bill line without a tax code (AL005)", async () => {
    const post = (taxCode: string | null) => async () => purchasePost(app, await purchaseDraft(app, { taxCode, taxes: false }));
    await run(post(W.taxCodeExempt)); // control: an exempt code needs no tax
    expect(await code(post(null))).toBe("AL005");
  });

  it("rejects a supplier tax that comes from no line code (AL005)", async () => {
    // The line is exempt, yet the bill records GST and QST.
    expect(await code(async () => purchasePost(app, await purchaseDraft(app, { taxCode: W.taxCodeExempt })))).toBe("AL005");
  });

  it("posts a supplier credit that references a posted bill of the same supplier", async () => {
    await run(async () => {
      const bill = await postedBill(app);
      const credit = await postedBill(app, { kind: "SUPPLIER_CREDIT", cents: 2000, credits: bill.id, date: "2026-04-05" });
      expect(await int(app, "SELECT entry_net_cents(app_tenant_id(), $1, ARRAY['ACCOUNTS_PAYABLE']::account_subtype[])::int AS n", [credit.entry])).toBe(2300); // 2 000 + 100 + 200 (9.975% of 2 000 is 199.5), debited
    });
  });

  it("rejects a supplier credit that references a bill not yet posted (AL006)", async () => {
    expect(
      await code(async () => {
        const draft = await purchaseDraft(app);
        await postedBill(app, { kind: "SUPPLIER_CREDIT", cents: 2000, credits: draft, date: "2026-04-05" });
      }),
    ).toBe("AL006");
  });

  it("rejects a supplier credit that references a bill of another contact (AL006)", async () => {
    expect(
      await code(async () => {
        const bill = await postedBill(app, { contact: W.customer }); // any contact other than the supplier of the credit
        await postedBill(app, { kind: "SUPPLIER_CREDIT", cents: 2000, credits: bill.id, date: "2026-04-05" });
      }),
    ).toBe("AL006");
  });

  it("rejects a credited document on a bill (23514)", async () => {
    expect(
      await code(async () => {
        const bill = await postedBill(app);
        await purchaseDraft(app, { credits: bill.id }); // kind BILL
      }),
    ).toBe("23514");
  });

  it("creates a purchase document as a draft, never already posted (AL006)", async () => {
    const insert = (status: string) => async () => {
      await app.query(
        `INSERT INTO purchase_document (id, company_id, kind, status, contact_id, document_date, posting_date, tax_rounding, created_by_id, updated_at)
         VALUES ($1, app_tenant_id(), 'BILL', $2::document_status, $3, '2026-04-01', '2026-04-01', 'PER_LINE', app_current_user_id(), now())`,
        [randomUUID(), status, W.supplier],
      );
    };
    await run(insert("DRAFT"));
    expect(await code(insert("POSTED"))).toBe("AL006");
  });

  it("rejects the status transition POSTED -> DRAFT of a purchase document (AL006)", async () => {
    expect(
      await code(async () => {
        const bill = await postedBill(app);
        await app.query("UPDATE purchase_document SET status = 'DRAFT', updated_at = now() WHERE id = $1", [bill.id]);
      }),
    ).toBe("AL006");
  });

  it("voids a posted bill with the reversal of its entry, and no other entry (AL006)", async () => {
    const voidWith = (ownEntry: boolean) => async () => {
      const bill = await postedBill(app);
      const other = await postedBill(app);
      await voidPurchase(app, bill.id, await reverse(app, ownEntry ? bill.entry : other.entry, "2026-04-20"));
    };
    await run(voidWith(true));
    expect(await code(voidWith(false))).toBe("AL006");
  });

  it("posts an expense that credits the account it was paid from", async () => {
    await run(async () => {
      const expense = await postedBill(app, { kind: "EXPENSE" });
      expect(await int(app, "SELECT entry_account_net_cents(app_tenant_id(), $1, $2)::int AS n", [expense.entry, W.bank])).toBe(-11498);
    });
  });

  it("rejects an expense entry that does not credit its payment account (AL006)", async () => {
    expect(await code(async () => purchasePost(app, await purchaseDraft(app, { kind: "EXPENSE" }), { creditAccount: W.capital }))).toBe("AL006");
  });

  it("rejects an expense paid from an account that is not a bank, cash or card account (AL005)", async () => {
    const create = (paymentAccount: string) => async () => purchaseDraft(app, { kind: "EXPENSE", paymentAccount });
    await run(create(W.bank));
    expect(await code(create(W.receivable))).toBe("AL005");
  });
});

describe("payments", () => {
  it("creates a payment posted, never void (AL006)", async () => {
    const create = (status: "POSTED" | "VOID") => async () => payment(app, { date: "2026-04-10", contact: W.customer, cents: 5000, account: W.bank, status });
    await run(create("POSTED"));
    expect(await code(create("VOID"))).toBe("AL006");
  });

  it("rejects a payment account that is not a bank, cash, card or current asset account (AL005)", async () => {
    const create = (account: string) => async () => payment(app, { date: "2026-04-10", contact: W.customer, cents: 5000, account });
    await run(create(W.bank));
    expect(await code(create(W.expenses))).toBe("AL005");
  });

  it("rejects a payment whose entry is not dated on the payment date (AL006)", async () => {
    const create = (entryDate: string) => async () => payment(app, { date: "2026-04-10", entryDate, contact: W.customer, cents: 5000, account: W.bank });
    await run(create("2026-04-10"));
    expect(await code(create("2026-04-11"))).toBe("AL006");
  });

  it("rejects changing a posted payment, which still lets its timestamp move (AL006)", async () => {
    await run(async () => {
      const receipt = await payment(app, { date: "2026-04-10", contact: W.customer, cents: 5000, account: W.bank });
      await app.query("UPDATE payment SET updated_at = now() WHERE id = $1", [receipt.id]);
    });
    expect(
      await code(async () => {
        const receipt = await payment(app, { date: "2026-04-10", contact: W.customer, cents: 5000, account: W.bank });
        await app.query("UPDATE payment SET amount_cents = amount_cents + 1 WHERE id = $1", [receipt.id]);
      }),
    ).toBe("AL006");
  });

  it("voids an unallocated, undeposited receipt with the reversal of its entry", async () => {
    await run(async () => {
      const receipt = await payment(app, { date: "2026-04-10", contact: W.customer, cents: 5000, account: W.bank });
      await voidPayment(app, receipt.id, await reverse(app, receipt.entry, "2026-04-20"));
      expect(await one(app, "SELECT status::text AS status FROM payment WHERE id = $1", [receipt.id])).toEqual({ status: "VOID" });
    });
  });

  it("rejects bringing a voided payment back (AL006)", async () => {
    expect(
      await code(async () => {
        const receipt = await payment(app, { date: "2026-04-10", contact: W.customer, cents: 5000, account: W.bank });
        await voidPayment(app, receipt.id, await reverse(app, receipt.entry, "2026-04-20"));
        await app.query("UPDATE payment SET status = 'POSTED', void_entry_id = NULL, voided_at = NULL, updated_at = now() WHERE id = $1", [receipt.id]);
      }),
    ).toBe("AL006");
  });

  it("rejects a void entry that does not reverse the payment entry (AL006)", async () => {
    const voidWith = (ownEntry: boolean) => async () => {
      const receipt = await payment(app, { date: "2026-04-10", contact: W.customer, cents: 5000, account: W.bank });
      const other = await payment(app, { date: "2026-04-10", contact: W.customer, cents: 700, account: W.bank });
      await voidPayment(app, receipt.id, await reverse(app, ownEntry ? receipt.entry : other.entry, "2026-04-20"));
    };
    await run(voidWith(true));
    expect(await code(voidWith(false))).toBe("AL006");
  });

  it("rejects voiding a payment that is still allocated (AL006)", async () => {
    const voidReceipt = (unapplyFirst: boolean) => async () => {
      const { receipt, allocation } = await allocatedReceipt(app);
      await settle(app);
      if (unapplyFirst) await unapplyAllocation(app, allocation, "2026-04-20");
      await voidPayment(app, receipt.id, await reverse(app, receipt.entry, "2026-04-20"));
    };
    await run(voidReceipt(true));
    expect(await code(voidReceipt(false))).toBe("AL006");
  });

  it("never deletes a payment: privilege for the application, trigger for the table owner", async () => {
    expect(
      await code(async () => {
        const receipt = await payment(app, { date: "2026-04-10", contact: W.customer, cents: 5000, account: W.bank });
        await app.query("DELETE FROM payment WHERE id = $1", [receipt.id]);
      }),
    ).toBe("42501");
    expect(
      await codeAsTableOwner(async () => {
        const receipt = await payment(db, { date: "2026-04-10", contact: W.customer, cents: 5000, account: W.bank });
        await db.query("DELETE FROM payment WHERE id = $1", [receipt.id]);
      }),
    ).toBe("AL006");
  });
});

describe("allocation rules", () => {
  it("rejects an allocation above the open amount of the payment (AL007)", async () => {
    const allocateCents = (cents: number) => async () => {
      const invoice = await postedInvoice(app);
      const receipt = await payment(app, { date: "2026-04-10", contact: W.customer, cents: 5000, account: W.bank });
      await allocate(app, { payment: receipt.id, sales: invoice.id, cents, date: "2026-04-10" });
    };
    await run(allocateCents(5000));
    expect(await code(allocateCents(5001))).toBe("AL007");
  });

  it("rejects an allocation between a payment and a document of different contacts (AL007)", async () => {
    const allocateFor = (contact: string) => async () => {
      const invoice = await postedInvoice(app);
      const receipt = await payment(app, { date: "2026-04-10", contact, cents: 5000, account: W.bank });
      await allocate(app, { payment: receipt.id, sales: invoice.id, cents: 5000, date: "2026-04-10" });
    };
    await run(allocateFor(W.customer));
    expect(await code(allocateFor(W.otherCustomer))).toBe("AL007");
  });

  it("allocates a refund to a credit note but not a receipt (AL007)", async () => {
    const allocateTo = (direction: "RECEIVED" | "SENT") => async () => {
      const invoice = await postedInvoice(app);
      const credit = await postedInvoice(app, { kind: "CREDIT_NOTE", cents: 3000, credits: invoice.id, date: "2026-04-05" });
      const money = await payment(app, { date: "2026-04-10", contact: W.customer, cents: 3449, account: W.bank, direction });
      await allocate(app, { payment: money.id, sales: credit.id, cents: 3449, date: "2026-04-10" });
    };
    await run(allocateTo("SENT"));
    expect(await code(allocateTo("RECEIVED"))).toBe("AL007");
  });

  it("allocates a payment sent to a supplier to a bill but not a payment received from them (AL007)", async () => {
    const allocateTo = (direction: "RECEIVED" | "SENT") => async () => {
      const bill = await postedBill(app);
      const money = await payment(app, { date: "2026-04-10", contact: W.supplier, cents: 11498, account: W.bank, direction, ledger: "PAYABLE" });
      await allocate(app, { payment: money.id, purchase: bill.id, cents: 11498, date: "2026-04-10" });
      expect(await billOpen(app, bill.id)).toBe(0);
    };
    await run(allocateTo("SENT"));
    expect(await code(allocateTo("RECEIVED"))).toBe("AL007");
  });

  it("rejects an allocation to an invoice not yet posted (AL007)", async () => {
    const allocateTo = (post: boolean) => async () => {
      const id = await salesDraft(app);
      const invoice = post ? await salesPost(app, id) : { id };
      const receipt = await payment(app, { date: "2026-04-10", contact: W.customer, cents: 5000, account: W.bank });
      await allocate(app, { payment: receipt.id, sales: invoice.id, cents: 5000, date: "2026-04-10" });
    };
    await run(allocateTo(true));
    expect(await code(allocateTo(false))).toBe("AL007");
  });

  it("rejects an allocation from a voided payment (AL007)", async () => {
    const allocateFrom = (voided: boolean) => async () => {
      const invoice = await postedInvoice(app);
      const receipt = await payment(app, { date: "2026-04-10", contact: W.customer, cents: 5000, account: W.bank });
      if (voided) await voidPayment(app, receipt.id, await reverse(app, receipt.entry, "2026-04-20"));
      await allocate(app, { payment: receipt.id, sales: invoice.id, cents: 5000, date: "2026-04-21" });
    };
    await run(allocateFrom(false));
    expect(await code(allocateFrom(true))).toBe("AL007");
  });

  it("rejects an allocation dated before the payment or the invoice (AL007)", async () => {
    const allocateOn = (date: string) => async () => {
      const invoice = await postedInvoice(app); // posted on 2026-04-01
      const receipt = await payment(app, { date: "2026-04-10", contact: W.customer, cents: 5000, account: W.bank });
      await allocate(app, { payment: receipt.id, sales: invoice.id, cents: 5000, date });
    };
    await run(allocateOn("2026-04-10"));
    expect(await code(allocateOn("2026-04-09"))).toBe("AL007");
  });

  it("rejects a new allocation dated in a locked period (AL003)", async () => {
    const allocateOn = (date: string) => async () => {
      const invoice = await postedInvoice(app);
      const receipt = await payment(app, { date: "2026-04-10", contact: W.customer, cents: 5000, account: W.bank });
      await settle(app);
      await lockPeriod(app, 4);
      await allocate(app, { payment: receipt.id, sales: invoice.id, cents: 5000, date });
    };
    await run(allocateOn("2026-05-02"));
    expect(await code(allocateOn("2026-04-12"))).toBe("AL003");
  });

  it("rejects two live allocations of a payment to the same invoice, but allows a new one after unapplying (23505)", async () => {
    const allocateTwice = (unapplyBetween: boolean) => async () => {
      const invoice = await postedInvoice(app);
      const receipt = await payment(app, { date: "2026-04-10", contact: W.customer, cents: 5000, account: W.bank });
      const first = await allocate(app, { payment: receipt.id, sales: invoice.id, cents: 1000, date: "2026-04-10" });
      if (unapplyBetween) await unapplyAllocation(app, first, "2026-04-11");
      await allocate(app, { payment: receipt.id, sales: invoice.id, cents: 1000, date: "2026-04-12" });
    };
    await run(allocateTwice(true));
    expect(await code(allocateTwice(false))).toBe("23505");
  });

  it("rejects an allocation that targets no document, two documents, or a zero amount (23514)", async () => {
    const allocateTo = (targets: ("invoice" | "bill")[], cents: number) => async () => {
      const invoice = await postedInvoice(app);
      const bill = await postedBill(app);
      const receipt = await payment(app, { date: "2026-04-10", contact: W.customer, cents: 5000, account: W.bank });
      await allocate(app, { payment: receipt.id, sales: targets.includes("invoice") ? invoice.id : undefined, purchase: targets.includes("bill") ? bill.id : undefined, cents, date: "2026-04-10" });
    };
    await run(allocateTo(["invoice"], 1000));
    expect(await code(allocateTo([], 1000))).toBe("23514");
    expect(await code(allocateTo(["invoice", "bill"], 1000))).toBe("23514");
    expect(await code(allocateTo(["invoice"], 0))).toBe("23514");
  });

  it("rejects unapplying an allocation twice (AL007)", async () => {
    const unapplyTimes = (times: number) => async () => {
      const { allocation } = await allocatedReceipt(app);
      await settle(app);
      for (let day = 0; day < times; day++) await unapplyAllocation(app, allocation, `2026-04-${20 + day}`);
    };
    await run(unapplyTimes(1));
    expect(await code(unapplyTimes(2))).toBe("AL007");
  });

  it("rejects rewriting an allocation: column privilege for the application", async () => {
    expect(
      await code(async () => {
        const { allocation } = await allocatedReceipt(app);
        await app.query("UPDATE payment_allocation SET amount_cents = 1 WHERE id = $1", [allocation]);
      }),
    ).toBe("42501");
  });
});

describe("offsets between a received and a sent payment", () => {
  const offsetOf = (o: { sentContact?: string; sentLedger?: "RECEIVABLE" | "PAYABLE"; cents?: number }) => async () => {
    const received = await payment(app, { date: "2026-04-10", contact: W.customer, cents: 5000, account: W.bank });
    const sent = await payment(app, { date: "2026-04-11", contact: o.sentContact ?? W.customer, cents: 3000, account: W.bank, direction: "SENT", ledger: o.sentLedger ?? "RECEIVABLE" });
    await offset(app, { received: received.id, sent: sent.id, cents: o.cents ?? 3000, date: "2026-04-12" });
    return { received, sent };
  };

  it("offsets a receipt against a refund of the same customer, lowering what is open on both", async () => {
    await run(async () => {
      const { received, sent } = await offsetOf({})();
      expect(await paymentOpen(app, received.id)).toBe(2000);
      expect(await paymentOpen(app, sent.id)).toBe(0);
    });
  });

  it("rejects an offset above the open amount of a payment (AL007)", async () => {
    expect(await code(offsetOf({ cents: 3001 }))).toBe("AL007");
  });

  it("rejects an offset between payments of different contacts (AL007)", async () => {
    expect(await code(offsetOf({ sentContact: W.otherCustomer }))).toBe("AL007");
  });

  it("rejects an offset between payments of different ledgers (AL007)", async () => {
    expect(await code(offsetOf({ sentLedger: "PAYABLE" }))).toBe("AL007");
  });
});

describe("deposit rules", () => {
  const receiptsOf = async (cents: number, date = "2026-04-10", account: string = W.undeposited) => payment(app, { date, contact: W.customer, cents, account });

  it("rejects a deposit whose total differs from its items (AL010)", async () => {
    const depositTotal = (total: number) => async () => deposit(app, { date: "2026-04-15", payments: [await receiptsOf(5000)], total });
    await run(depositTotal(5000));
    expect(await code(depositTotal(4000))).toBe("AL010");
  });

  // bank_deposit_check runs on the items only; bank_deposit_complete (migration deposit_needs_items) covers the deposit
  // that has none, which would take its total out of undeposited funds without depositing any payment.
  it("rejects a deposit without items (AL010)", async () => {
    // The control, a deposit with its item, is T45.
    expect(await code(async () => deposit(app, { date: "2026-04-15", payments: [], total: 5000 }))).toBe("AL010");
  });

  it("rejects a deposit entry that does not move the total from undeposited funds to the bank (AL006)", async () => {
    const depositEntry = (entryTotal: number) => async () => deposit(app, { date: "2026-04-15", payments: [await receiptsOf(5000)], entryTotal });
    await run(depositEntry(5000));
    expect(await code(depositEntry(4000))).toBe("AL006");
  });

  it("rejects depositing a payment that was not received into undeposited funds (AL010)", async () => {
    const depositFrom = (account: string) => async () => deposit(app, { date: "2026-04-15", payments: [await receiptsOf(5000, "2026-04-10", account)] });
    await run(depositFrom(W.undeposited));
    expect(await code(depositFrom(W.bank))).toBe("AL010");
  });

  it("rejects depositing a payment dated after the deposit (AL010)", async () => {
    const depositAfter = (paymentDate: string) => async () => deposit(app, { date: "2026-04-15", payments: [await receiptsOf(5000, paymentDate)] });
    await run(depositAfter("2026-04-15"));
    expect(await code(depositAfter("2026-04-16"))).toBe("AL010");
  });

  it("rejects a deposit into an account that is not a bank or cash account (AL005)", async () => {
    const depositInto = (account: string) => async () => deposit(app, { date: "2026-04-15", payments: [await receiptsOf(5000)], account });
    await run(depositInto(W.bank));
    expect(await code(depositInto(W.expenses))).toBe("AL005");
  });

  it("rejects changing a posted deposit other than by voiding it (AL010)", async () => {
    const change = (void_: boolean) => async () => {
      const dep = await deposit(app, { date: "2026-04-15", payments: [await receiptsOf(5000)] });
      if (void_) await voidDeposit(app, dep.id, await reverse(app, dep.entry, "2026-04-20"));
      else await app.query("UPDATE bank_deposit SET deposit_date = '2026-04-16' WHERE id = $1", [dep.id]);
    };
    await run(change(true));
    expect(await code(change(false))).toBe("AL010");
  });

  it("voids a deposit with the reversal of its entry, which frees its receipts for a new deposit", async () => {
    await run(async () => {
      const receipt = await receiptsOf(5000);
      const first = await deposit(app, { date: "2026-04-15", payments: [receipt] });
      await settle(app);
      await voidDeposit(app, first.id, await reverse(app, first.entry, "2026-04-20"));
      await deposit(app, { date: "2026-04-21", payments: [receipt] });
    });
  });

  it("rejects a deposit void entry that does not reverse the deposit entry (AL010)", async () => {
    const voidWith = (ownEntry: boolean) => async () => {
      const first = await deposit(app, { date: "2026-04-15", payments: [await receiptsOf(5000)] });
      const second = await deposit(app, { date: "2026-04-15", payments: [await receiptsOf(700)] });
      await voidDeposit(app, first.id, await reverse(app, ownEntry ? first.entry : second.entry, "2026-04-20"));
    };
    await run(voidWith(true));
    expect(await code(voidWith(false))).toBe("AL010");
  });

  it("never deletes a deposit: privilege for the application, trigger for the table owner", async () => {
    expect(
      await code(async () => {
        const dep = await deposit(app, { date: "2026-04-15", payments: [await receiptsOf(5000)] });
        await app.query("DELETE FROM bank_deposit WHERE id = $1", [dep.id]);
      }),
    ).toBe("42501");
    expect(
      await codeAsTableOwner(async () => {
        const receipt = await payment(db, { date: "2026-04-10", contact: W.customer, cents: 5000, account: W.undeposited });
        const dep = await deposit(db, { date: "2026-04-15", payments: [receipt] });
        await db.query("DELETE FROM bank_deposit WHERE id = $1", [dep.id]);
      }),
    ).toBe("AL010");
  });
});

describe("rules that back up the privileges (table owner)", () => {
  it("lets the table owner unapply an allocation, but never delete or rewrite it (AL007)", async () => {
    const onAllocation = (sql: string) => async () => {
      const { allocation } = await allocatedReceipt(db);
      await db.query(sql, [allocation]);
    };
    expect(await codeAsTableOwner(onAllocation("UPDATE payment_allocation SET unapplied_date = '2026-04-20', unapplied_by_id = app_current_user_id() WHERE id = $1"))).toBeNull();
    expect(await codeAsTableOwner(onAllocation("DELETE FROM payment_allocation WHERE id = $1"))).toBe("AL007");
    expect(await codeAsTableOwner(onAllocation("UPDATE payment_allocation SET amount_cents = 1 WHERE id = $1"))).toBe("AL007");
  });

  it("never deletes a credit application or an offset: privilege for the application, trigger for the table owner", async () => {
    const withApplications = (c: pg.Client, table: "sales_credit_application" | "payment_offset") => async () => {
      if (table === "sales_credit_application") {
        const invoice = await postedInvoice(c);
        const credit = await postedInvoice(c, { kind: "CREDIT_NOTE", cents: 3000, credits: invoice.id, date: "2026-04-05" });
        await applyCredit(c, { creditNote: credit.id, invoice: invoice.id, cents: 1000, date: "2026-04-06" });
      } else {
        const received = await payment(c, { date: "2026-04-10", contact: W.customer, cents: 5000, account: W.bank });
        const sent = await payment(c, { date: "2026-04-11", contact: W.customer, cents: 3000, account: W.bank, direction: "SENT" });
        await offset(c, { received: received.id, sent: sent.id, cents: 3000, date: "2026-04-12" });
      }
      await c.query(`DELETE FROM ${table}`);
    };
    for (const table of ["sales_credit_application", "payment_offset"] as const) {
      expect(await code(withApplications(app, table)), table).toBe("42501");
      expect(await codeAsTableOwner(withApplications(db, table)), table).toBe("AL007");
    }
  });

  it("never rewrites or deletes a deposit item: privilege for the application, trigger for the table owner (AL004)", async () => {
    const onItem = (c: pg.Client, sql: string) => async () => {
      const receipt = await payment(c, { date: "2026-04-10", contact: W.customer, cents: 5000, account: W.undeposited });
      const dep = await deposit(c, { date: "2026-04-15", payments: [receipt] });
      await c.query(sql, [dep.id]);
    };
    const rewrite = "UPDATE bank_deposit_item SET payment_id = payment_id WHERE deposit_id = $1";
    const remove = "DELETE FROM bank_deposit_item WHERE deposit_id = $1";
    expect(await code(onItem(app, rewrite))).toBe("42501");
    expect(await code(onItem(app, remove))).toBe("42501");
    expect(await codeAsTableOwner(onItem(db, rewrite))).toBe("AL004");
    expect(await codeAsTableOwner(onItem(db, remove))).toBe("AL004");
  });
});
