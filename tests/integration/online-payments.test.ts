import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cancelPaymentLink, collectPayments, createConnection, createPaymentLink, disconnect, getConnection, listFeeAccounts, listInvoicePaymentLinks, listPaymentConnections, setFeeAccount,
} from "@/modules/integrations";
import { listFiscalYears, lockPeriod } from "@/modules/ledger";
import { recordReceipt } from "@/modules/payments";
import { getDraft, getInvoiceOpenCents, postInvoice, saveDraft, voidInvoice } from "@/modules/sales";
import { AppError } from "@/platform/errors";
import type { CompanyContext } from "@/platform/tenant";
import { owner } from "./helpers";
import { fakeHttp, STRIPE_ORIGIN, stripeShop, type Reply } from "./providers";
import { seedWorld, W } from "./world";

const actor: CompanyContext = { userId: W.userOwnerA, companyId: W.companyA };
const accountant: CompanyContext = { ...actor, userId: W.userAccountant };
const reader: CompanyContext = { ...actor, userId: W.userReader };
const otherOwner: CompanyContext = { userId: W.userOwnerB, companyId: W.companyB };
// Receipts are refused after today: a fixed clock keeps the tests independent of the day they run.
const NOW = new Date("2026-12-31T12:00:00Z");
const KEY = `sk_live_${"AbCd1234Ef".repeat(3)}`;
const TOTAL = 11498n; // 100,00 $ + GST 5,00 $ + QST 9,98 $
const FEE = 363n; // Stripe's usual 2.9 % + 0.30 on 114.98, as the fake computes it
const PAID_AT = "2026-06-15T15:00:00Z";

let db: pg.Client;
let accountCounter = 0;
let labelCounter = 0;
beforeAll(async () => {
  db = await owner();
  await seedWorld(db);
  await db.query("INSERT INTO number_sequence(company_id,key,next_value,prefix,padding) VALUES ($1,'JOURNAL_ENTRY',1,'J-',5),($1,'INVOICE',1,'F-',5),($1,'CREDIT_NOTE',1,'AV-',5),($1,'PAYMENT_RECEIVED',1,'E-',5)", [W.companyA]);
});
afterAll(async () => { await db?.end(); });

async function refusal(promise: Promise<unknown>): Promise<string> {
  try { await promise; } catch (error) { if (error instanceof AppError) return error.key; throw error; }
  throw new Error("expected a refusal");
}
const count = async (sql: string, args: unknown[] = []) => (await db.query(`SELECT count(*)::int AS n FROM ${sql}`, args)).rows[0].n as number;
const one = async (sql: string, args: unknown[] = []) => (await db.query(sql, args)).rows[0];

/** A bank account of its own for each test, so balances are the test's own. */
async function bankAccount(): Promise<string> {
  const id = randomUUID();
  await db.query("INSERT INTO account (id, company_id, code, name_fr, name_en, type, subtype, updated_at) VALUES ($1, $2, $3, 'Stripe', 'Stripe', 'ASSET', 'BANK', now())", [id, W.companyA, `14${String(++accountCounter).padStart(2, "0")}`]);
  return id;
}
async function invoice(date = "2026-06-01", unitPrice = "100") {
  const id = await saveDraft(actor, { contactId: W.customer, issueDate: date, dueDate: "2026-12-01", lines: [{ description: "Service", quantity: "1", unitPrice, accountId: W.sales, taxCodeId: unitPrice === "100" ? W.taxCodeStandard : W.taxCodeExempt }] });
  await postInvoice(actor, id, (await getDraft(actor, id))!.revision, date);
  return id;
}
const open = async (id: string) => (await getInvoiceOpenCents(actor, id))!;
/** What the books say the service holds: debits minus credits on the account of the connection. */
const balance = async (account: string) => BigInt((await one("SELECT coalesce(sum(debit_cents - credit_cents), 0)::text AS b FROM journal_line WHERE account_id = $1", [account])).b);

type ShopOptions = { fee?: boolean; onRequest?: (url: URL, init: { method?: string }) => Reply | undefined };
async function connection(options: ShopOptions = {}) {
  const shop = stripeShop({ key: KEY, transactions: () => [], onRequest: options.onRequest });
  const fake = fakeHttp(shop.handler);
  const account = await bankAccount();
  const { id } = await createConnection(actor, { provider: "STRIPE", label: `Stripe ${++labelCounter}`, accountId: account, importFrom: "2026-01-01", credentials: { apiKey: KEY } }, { http: fake.http, now: NOW });
  if (options.fee !== false) await setFeeAccount(actor, id, W.expenses);
  fake.calls.length = 0; // from here on, only what the payment pages ask for
  return { id, account, shop, calls: fake.calls, deps: { http: fake.http, now: NOW } };
}
type Conn = Awaited<ReturnType<typeof connection>>;
const makeLink = (conn: Conn, invoiceId: string, who: CompanyContext = actor) => createPaymentLink(who, { invoiceId, connectionId: conn.id }, conn.deps);
const collect = (conn: Conn, who: CompanyContext = actor) => collectPayments(who, { connectionId: conn.id }, conn.deps);
const linkRow = async (id: string) => one("SELECT * FROM payment_link WHERE id = $1", [id]);
/** The Stripe id of a link made here. */
const plink = async (id: string) => (await linkRow(id)).external_id as string;
const posts = (conn: Conn) => conn.calls.filter((call) => call.method === "POST");

describe("the account that processing fees go to", () => {
  it("is chosen by the owner among expense accounts, and shows on the connection", async () => {
    const conn = await connection({ fee: false });
    expect((await getConnection(actor, conn.id, { now: NOW }))?.feeAccountId).toBeNull();
    expect((await listFeeAccounts(reader)).map((account) => account.id)).toContain(W.expenses);
    await setFeeAccount(actor, conn.id, W.expenses);
    expect(await getConnection(reader, conn.id, { now: NOW })).toMatchObject({ feeAccountId: W.expenses, feeAccountCode: "5000" });
    expect((await one("SELECT fee_account_id FROM integration_connection WHERE id = $1", [conn.id])).fee_account_id).toBe(W.expenses);
  });

  it("refuses what is not an active expense account of this company, and anyone but the owner", async () => {
    const conn = await connection({ fee: false });
    for (const [label, account] of [["revenue", W.sales], ["bank", W.bank], ["receivables", W.receivable], ["another company's", "00000000-0000-7000-8000-00000000b500"], ["unknown", randomUUID()]] as const) {
      expect(await refusal(setFeeAccount(actor, conn.id, account)), label).toBe("onlinePayments.feeAccountInvalid");
    }
    for (const who of [accountant, reader]) expect(await refusal(setFeeAccount(who, conn.id, W.expenses))).toBe("forbidden");
    expect(await refusal(setFeeAccount(otherOwner, conn.id, W.expenses))).toBe("integrations.notFound");
    expect((await one("SELECT fee_account_id FROM integration_connection WHERE id = $1", [conn.id])).fee_account_id).toBeNull();
  });
});

describe("making a payment link", () => {
  it("asks the service for a price and a page for the open balance, once each, and keeps the address", async () => {
    const conn = await connection();
    const invoiceId = await invoice();
    const made = await makeLink(conn, invoiceId);

    const row = await linkRow(made.id);
    expect(row).toMatchObject({ company_id: W.companyA, invoice_id: invoiceId, connection_id: conn.id, status: "ACTIVE", currency: "CAD", last_error: null, review_reason: null, created_by_id: W.userOwnerA });
    expect(BigInt(row.amount_cents)).toBe(TOTAL);
    expect(made.url).toMatch(/^https:\/\/buy\.stripe\.com\/test_\d+$/);
    expect(row).toMatchObject({ url: made.url, external_id: expect.stringMatching(/^plink_/), external_price_id: expect.stringMatching(/^price_/) });

    // two POSTs, in that order, each with the key that makes a retry safe; the key of the account travels in a header only
    expect(posts(conn).map((call) => new URL(call.url).pathname)).toEqual(["/v1/prices", "/v1/payment_links"]);
    expect(posts(conn).map((call) => call.headers["Idempotency-Key"])).toEqual([`allumi-price-${made.id}`, `allumi-link-${made.id}`]);
    expect(conn.calls.every((call) => call.headers.Authorization === `Bearer ${KEY}` && !call.url.includes(KEY) && call.url.startsWith(STRIPE_ORIGIN))).toBe(true);
    const price = new URLSearchParams(posts(conn)[0]!.body);
    expect(Object.fromEntries(price)).toEqual({ currency: "cad", unit_amount: String(TOTAL), "product_data[name]": "Facture F-00001", "metadata[allumi_link]": made.id });
    const page = new URLSearchParams(posts(conn)[1]!.body);
    expect(page.get("line_items[0][price]")).toBe(row.external_price_id);
    expect(page.get("line_items[0][quantity]")).toBe("1");
    expect(page.get("restrictions[completed_sessions][limit]")).toBe("1"); // an invoice is not paid twice
    expect(page.get("metadata[allumi_link]")).toBe(made.id);
    expect(page.get("payment_intent_data[description]")).toBe("Facture F-00001");
    // nothing about the customer or the company leaves
    expect(posts(conn).map((call) => call.body).join()).not.toMatch(/Client Fictif|companyA|@/);

    expect(await listInvoicePaymentLinks(reader, invoiceId)).toEqual([
      expect.objectContaining({ id: made.id, status: "ACTIVE", amountCents: TOTAL, currency: "CAD", url: made.url, payment: null, connectionLabel: expect.stringMatching(/^Stripe /) }),
    ]);
    expect((await listPaymentConnections(reader)).map((c) => c.id)).toContain(conn.id);
  });

  it("makes one link when the button is pressed twice at once", async () => {
    const conn = await connection();
    const invoiceId = await invoice();
    const [a, b] = await Promise.all([makeLink(conn, invoiceId), makeLink(conn, invoiceId)]);
    expect(b).toEqual(a);
    expect(await count("payment_link WHERE invoice_id = $1", [invoiceId])).toBe(1);
    expect(await linkRow(a.id)).toMatchObject({ status: "ACTIVE", url: a.url });
    expect(conn.shop.links.size).toBe(1);
  });

  it("gives back the live link for the same balance without calling the service again", async () => {
    const conn = await connection();
    const invoiceId = await invoice();
    const first = await makeLink(conn, invoiceId);
    conn.calls.length = 0;
    expect(await makeLink(conn, invoiceId)).toEqual(first);
    expect(conn.calls).toHaveLength(0);
    expect(await count("payment_link WHERE invoice_id = $1", [invoiceId])).toBe(1);
  });

  it("writes in English on the page of an invoice issued in English", async () => {
    const conn = await connection();
    const draft = await saveDraft(actor, { contactId: W.customer, issueDate: "2026-06-01", dueDate: "2026-12-01", lines: [{ description: "Service", quantity: "1", unitPrice: "100", accountId: W.sales, taxCodeId: W.taxCodeStandard }] });
    await db.query("UPDATE sales_document SET locale = 'en' WHERE id = $1 AND status = 'DRAFT'", [draft]); // the language is settled before posting
    await postInvoice(actor, draft, (await getDraft(actor, draft))!.revision, "2026-06-01");
    await makeLink(conn, draft);
    expect(new URLSearchParams(posts(conn)[0]!.body).get("product_data[name]")).toMatch(/^Invoice F-\d{5}$/);
    expect(new URLSearchParams(posts(conn)[1]!.body).get("payment_intent_data[description]")).toMatch(/^Invoice F-\d{5}$/);
  });

  it("refuses what cannot be paid online before calling anyone", async () => {
    const conn = await connection();
    const draft = await saveDraft(actor, { contactId: W.customer, issueDate: "2026-06-01", dueDate: "2026-12-01", lines: [{ description: "Service", quantity: "1", unitPrice: "100", accountId: W.sales, taxCodeId: W.taxCodeStandard }] });
    const paid = await invoice();
    await recordReceipt(actor, { invoiceId: paid, amountCents: String(TOTAL), expectedOpenCents: String(TOTAL), date: "2026-06-15", accountId: W.bank, method: "EFT" }, { now: NOW });
    const voided = await invoice();
    await voidInvoice(actor, voided, "2026-06-20", "Erreur de saisie");
    const tiny = await invoice("2026-06-01", "0.30");
    const cases: [string, string, string][] = [
      ["a draft", draft, "payments.invoiceNotOpen"],
      ["a voided invoice", voided, "payments.invoiceNotOpen"],
      ["an invoice already paid", paid, "onlinePayments.nothingDue"],
      ["less than the service takes", tiny, "onlinePayments.amountRange"],
      ["something that is not an invoice", randomUUID(), "onlinePayments.invoiceNotFound"],
    ];
    for (const [label, invoiceId, key] of cases) {
      expect(await refusal(makeLink(conn, invoiceId)), label).toBe(key);
    }
    expect(await refusal(createPaymentLink(actor, { invoiceId: "pas-un-id", connectionId: conn.id }, conn.deps))).toBe("onlinePayments.invalid");
    expect(conn.calls).toHaveLength(0);
    expect(await count("payment_link WHERE connection_id = $1", [conn.id])).toBe(0);
  });

  it("needs a connection that can take it: active, with a fee account, the owner's", async () => {
    const noFee = await connection({ fee: false });
    const invoiceId = await invoice();
    expect(await refusal(makeLink(noFee, invoiceId))).toBe("onlinePayments.feeAccount");
    expect((await listPaymentConnections(reader)).map((c) => c.id)).not.toContain(noFee.id);

    const conn = await connection();
    for (const who of [accountant, reader]) expect(await refusal(makeLink(conn, invoiceId, who))).toBe("forbidden");
    expect(await refusal(makeLink(conn, randomUUID()))).toBe("onlinePayments.invoiceNotFound");
    expect(await refusal(createPaymentLink(actor, { invoiceId, connectionId: randomUUID() }, conn.deps))).toBe("integrations.notFound");
    expect(await refusal(createPaymentLink(otherOwner, { invoiceId, connectionId: conn.id }, conn.deps))).toBe("integrations.notFound");
    await disconnect(actor, conn.id);
    expect(await refusal(makeLink(conn, invoiceId))).toBe("integrations.disabled");
    expect(conn.calls).toHaveLength(0);
  });

  it("will not make a second live link for another balance: the first is cancelled on purpose", async () => {
    const conn = await connection();
    const invoiceId = await invoice();
    const first = await makeLink(conn, invoiceId);
    await recordReceipt(actor, { invoiceId, amountCents: "5000", expectedOpenCents: String(TOTAL), date: "2026-06-15", accountId: W.bank, method: "EFT" }, { now: NOW });
    expect(await refusal(makeLink(conn, invoiceId))).toBe("onlinePayments.linkExists");

    expect(await cancelPaymentLink(actor, first.id, conn.deps)).toEqual({ status: "CANCELLED", closedAtService: true });
    const second = await makeLink(conn, invoiceId);
    expect(second.id).not.toBe(first.id);
    expect(BigInt((await linkRow(second.id)).amount_cents)).toBe(TOTAL - 5000n);
    expect(new URLSearchParams(posts(conn).filter((call) => call.url.endsWith("/v1/prices")).at(-1)!.body).get("unit_amount")).toBe(String(TOTAL - 5000n));
    expect((await listInvoicePaymentLinks(actor, invoiceId)).map((link) => link.status)).toEqual(["ACTIVE", "CANCELLED"]);
  });

  it("is resumed where it stopped when the service fails halfway, and says why", async () => {
    let failLink = true;
    const conn = await connection({ onRequest: (url, init) => (failLink && init.method === "POST" && url.pathname === "/v1/payment_links" ? { status: 503, body: { error: { message: "Stripe is down for sk_live_SECRET" } } } : undefined) });
    const invoiceId = await invoice();
    expect(await refusal(makeLink(conn, invoiceId))).toBe("integrations.unavailable");
    const pending = await one("SELECT * FROM payment_link WHERE invoice_id = $1", [invoiceId]);
    expect(pending).toMatchObject({ status: "PENDING", last_error: "integrations.unavailable", external_id: null, url: null, external_price_id: expect.stringMatching(/^price_/) });
    // the text of the service is not kept anywhere
    expect(JSON.stringify(await db.query("SELECT * FROM payment_link"))).not.toContain("SECRET");
    expect(JSON.stringify((await db.query("SELECT before::text AS b, after::text AS a FROM audit_log WHERE entity_type = 'payment_link'")).rows)).not.toContain("SECRET");

    failLink = false;
    conn.calls.length = 0;
    const made = await makeLink(conn, invoiceId);
    expect(made.id).toBe(pending.id);
    expect(posts(conn).map((call) => new URL(call.url).pathname)).toEqual(["/v1/payment_links"]); // the price is not made again
    expect(posts(conn)[0]!.headers["Idempotency-Key"]).toBe(`allumi-link-${pending.id}`);
    expect(await linkRow(made.id)).toMatchObject({ status: "ACTIVE", last_error: null });
    expect(await count("payment_link WHERE invoice_id = $1", [invoiceId])).toBe(1);
  });

  it("replaces a pending link that nobody finished when the balance has moved", async () => {
    let failLink = true;
    const conn = await connection({ onRequest: (url, init) => (failLink && init.method === "POST" && url.pathname === "/v1/payment_links" ? { status: 500, body: {} } : undefined) });
    const invoiceId = await invoice();
    await refusal(makeLink(conn, invoiceId));
    const stale = await one("SELECT id FROM payment_link WHERE invoice_id = $1", [invoiceId]);
    await recordReceipt(actor, { invoiceId, amountCents: "1000", expectedOpenCents: String(TOTAL), date: "2026-06-15", accountId: W.bank, method: "EFT" }, { now: NOW });
    failLink = false;
    const made = await makeLink(conn, invoiceId);
    expect(made.id).not.toBe(stale.id);
    expect((await linkRow(stale.id)).status).toBe("CANCELLED");
    expect(BigInt((await linkRow(made.id)).amount_cents)).toBe(TOTAL - 1000n);
  });
});

describe("collecting what customers paid", () => {
  it("books the receipt at the gross amount and the fees apart, so the account holds what the service pays out", async () => {
    const conn = await connection();
    const invoiceId = await invoice();
    const made = await makeLink(conn, invoiceId);
    const session = conn.shop.pay(await plink(made.id), { at: PAID_AT });
    conn.calls.length = 0;

    expect(await collect(conn)).toEqual({ checked: 1, paid: 1, review: 0, extra: 0, waiting: 0, failed: 0, more: false });

    // only reads: the sessions of the page, then the intent of the paid one with its balance transaction
    expect(conn.calls.map((call) => `${call.method} ${new URL(call.url).pathname}`)).toEqual(["GET /v1/checkout/sessions", `GET /v1/payment_intents/${session.payment_intent}`]);
    const intent = conn.shop.intents.get(session.payment_intent!)!;
    const sessionsUrl = new URL(conn.calls[0]!.url);
    expect(Object.fromEntries(sessionsUrl.searchParams)).toEqual({ payment_link: await plink(made.id), status: "complete", limit: "20" });
    expect(new URL(conn.calls[1]!.url).searchParams.getAll("expand[]")).toEqual(["latest_charge.balance_transaction"]);

    // the receipt: gross on the account of the connection, applied to the invoice, reference = the payment's id at the service
    expect(await open(invoiceId)).toBe(0n);
    const online = await one("SELECT * FROM online_payment WHERE link_id = $1", [made.id]);
    expect(online).toMatchObject({ company_id: W.companyA, provider_ref: session.id, currency: "CAD", created_by_id: W.userOwnerA });
    expect([BigInt(online.gross_cents), BigInt(online.fee_cents), BigInt(online.net_cents)]).toEqual([TOTAL, FEE, TOTAL - FEE]);
    expect(online.paid_at.toISOString()).toBe(new Date(PAID_AT).toISOString());
    const payment = await one("SELECT * FROM payment WHERE id = $1", [online.payment_id]);
    expect(payment).toMatchObject({ direction: "RECEIVED", ledger: "RECEIVABLE", status: "POSTED", account_id: conn.account, method: "CREDIT_CARD", reference: intent.id, contact_id: W.customer });
    expect(BigInt(payment.amount_cents)).toBe(TOTAL);
    expect(payment.payment_date.toISOString().slice(0, 10)).toBe("2026-06-15");
    expect(await count("payment_allocation WHERE payment_id = $1 AND sales_document_id = $2 AND unapplied_date IS NULL", [payment.id, invoiceId])).toBe(1);

    // the fees: a balanced entry of their own, expense up, balance held at the service down
    const fee = await one("SELECT id, source_type, entry_date::text AS d, memo FROM journal_entry WHERE id = $1", [online.fee_entry_id]);
    expect(fee).toMatchObject({ source_type: "MANUAL", d: "2026-06-15", memo: `Stripe · ${payment.number}` });
    expect((await db.query("SELECT account_id, debit_cents::text AS debit, credit_cents::text AS credit FROM journal_line WHERE entry_id = $1 ORDER BY line_no", [fee.id])).rows).toEqual([
      { account_id: W.expenses, debit: String(FEE), credit: "0" },
      { account_id: conn.account, debit: "0", credit: String(FEE) },
    ]);
    // what the books say the service holds is what the service will pay out
    expect(await balance(conn.account)).toBe(TOTAL - FEE);
    expect(await linkRow(made.id)).toMatchObject({ status: "PAID", review_reason: null, last_error: null });

    const [shown] = await listInvoicePaymentLinks(reader, invoiceId);
    expect(shown).toMatchObject({ status: "PAID", payment: { paymentId: payment.id, number: payment.number, grossCents: TOTAL, feeCents: FEE, netCents: TOTAL - FEE } });
  });

  it("books each payment once, however many times it is looked at, even at the same time", async () => {
    const conn = await connection();
    const invoiceId = await invoice();
    const made = await makeLink(conn, invoiceId);
    conn.shop.pay(await plink(made.id), { at: PAID_AT });
    const results = await Promise.all([collect(conn), collect(conn), collect(conn)]);
    expect(results.reduce((sum, r) => sum + r.paid, 0)).toBe(1);
    expect(results.reduce((sum, r) => sum + r.extra + r.review, 0)).toBe(0); // the others found it booked, not paid twice
    expect(await count("online_payment WHERE link_id = $1", [made.id])).toBe(1);
    expect(await count("payment WHERE account_id = $1", [conn.account])).toBe(1);
    expect(await balance(conn.account)).toBe(TOTAL - FEE);
    // the link is paid: it is not looked at again
    expect(await collect(conn)).toMatchObject({ checked: 0, paid: 0 });
    expect(await count("online_payment WHERE link_id = $1", [made.id])).toBe(1);
  });

  it("books no fee entry when the service kept nothing", async () => {
    const conn = await connection();
    const made = await makeLink(conn, await invoice());
    conn.shop.pay(await plink(made.id), { at: PAID_AT, fee: 0 });
    await collect(conn);
    const online = await one("SELECT * FROM online_payment WHERE link_id = $1", [made.id]);
    expect(online).toMatchObject({ fee_entry_id: null });
    expect([BigInt(online.fee_cents), BigInt(online.net_cents)]).toEqual([0n, TOTAL]);
    expect(await balance(conn.account)).toBe(TOTAL);
  });

  it("waits for a payment that is still clearing, and books it when it has settled", async () => {
    const conn = await connection();
    const invoiceId = await invoice();
    const made = await makeLink(conn, invoiceId);
    const session = conn.shop.pay(await plink(made.id), { at: PAID_AT, paymentStatus: "unpaid" });
    expect(await collect(conn)).toMatchObject({ checked: 1, paid: 0, waiting: 1, review: 0 });
    expect(await open(invoiceId)).toBe(TOTAL);
    expect((await linkRow(made.id)).status).toBe("ACTIVE");

    conn.shop.settle(session.id);
    expect(await collect(conn)).toMatchObject({ paid: 1, waiting: 0 });
    expect(await open(invoiceId)).toBe(0n);
    // a paid session whose balance transaction does not exist yet is also waited for
    const second = await makeLink(conn, await invoice());
    conn.shop.pay(await plink(second.id), { at: PAID_AT, settled: false });
    expect(await collect(conn)).toMatchObject({ paid: 0, waiting: 1 });
  });

  it("puts a payment under review, books nothing, and says why, when the balance is no longer what the link was for", async () => {
    const conn = await connection();
    const invoiceId = await invoice();
    const made = await makeLink(conn, invoiceId);
    // someone recorded a payment by hand after the link was made
    await recordReceipt(actor, { invoiceId, amountCents: "5000", expectedOpenCents: String(TOTAL), date: "2026-06-14", accountId: W.bank, method: "EFT" }, { now: NOW });
    const before = { payments: await count("payment"), entries: await count("journal_entry"), bank: await balance(conn.account) };
    conn.shop.pay(await plink(made.id), { at: PAID_AT });

    expect(await collect(conn)).toMatchObject({ paid: 0, review: 1 });
    expect(await linkRow(made.id)).toMatchObject({ status: "REVIEW", review_reason: "payments.exceeds" });
    // the refused booking left no trace: no receipt, no entry, no online payment
    expect({ payments: await count("payment"), entries: await count("journal_entry"), bank: await balance(conn.account) }).toEqual(before);
    expect(await count("online_payment WHERE link_id = $1", [made.id])).toBe(0);
    expect(await open(invoiceId)).toBe(TOTAL - 5000n);
    // and it is not looked at again until the owner decides
    expect(await collect(conn)).toMatchObject({ checked: 0, review: 0 });
    expect((await listInvoicePaymentLinks(reader, invoiceId))[0]).toMatchObject({ status: "REVIEW", reviewReason: "payments.exceeds", payment: null });
  });

  it("puts under review what the books refuse: a voided invoice, a locked period", async () => {
    const conn = await connection();
    const voidedInvoice = await invoice();
    const voidedLink = await makeLink(conn, voidedInvoice);
    await voidInvoice(actor, voidedInvoice, "2026-06-20", "Erreur de saisie");
    conn.shop.pay(await plink(voidedLink.id), { at: PAID_AT });

    const lockedInvoice = await invoice("2026-03-01");
    const lockedLink = await makeLink(conn, lockedInvoice);
    conn.shop.pay(await plink(lockedLink.id), { at: "2026-03-10T15:00:00Z" });
    const year = (await listFiscalYears(actor)).find((fiscalYear) => fiscalYear.start === "2026-01-01")!;
    await lockPeriod(actor, year.periods.find((period) => period.start === "2026-03-01")!.id);

    expect(await collect(conn)).toMatchObject({ checked: 2, paid: 0, review: 2 });
    expect(await linkRow(voidedLink.id)).toMatchObject({ status: "REVIEW", review_reason: "payments.invoiceNotOpen" });
    // a database rule has a code the person cannot read: it is kept as a general reason
    expect(await linkRow(lockedLink.id)).toMatchObject({ status: "REVIEW", review_reason: "onlinePayments.rule" });
    expect(await count("online_payment WHERE link_id IN ($1, $2)", [voidedLink.id, lockedLink.id])).toBe(0);
    expect(await balance(conn.account)).toBe(0n);
    expect(await open(lockedInvoice)).toBe(TOTAL);
  });

  it("puts a payment under review when the connection has lost its fee account since the link was made", async () => {
    const conn = await connection();
    const made = await makeLink(conn, await invoice());
    conn.shop.pay(await plink(made.id), { at: PAID_AT });
    await db.query("UPDATE integration_connection SET fee_account_id = NULL WHERE id = $1", [conn.id]);
    expect(await collect(conn)).toMatchObject({ paid: 0, review: 1 });
    expect(await linkRow(made.id)).toMatchObject({ status: "REVIEW", review_reason: "onlinePayments.feeAccount" });
    expect(await balance(conn.account)).toBe(0n);
  });

  it("puts under review a payment whose figures are not the link's: another amount, another currency at the bank", async () => {
    const conn = await connection();
    const wrongAmount = await makeLink(conn, await invoice());
    conn.shop.pay(await plink(wrongAmount.id), { at: PAID_AT, amount: 9000 });
    const wrongCurrency = await makeLink(conn, await invoice());
    conn.shop.pay(await plink(wrongCurrency.id), { at: PAID_AT, settlement: "usd" });
    expect(await collect(conn)).toMatchObject({ checked: 2, paid: 0, review: 2 });
    expect((await linkRow(wrongAmount.id)).review_reason).toBe("onlinePayments.amount");
    expect((await linkRow(wrongCurrency.id)).review_reason).toBe("onlinePayments.settlementCurrency");
    expect(await balance(conn.account)).toBe(0n);
  });

  it("counts a second payment on a paid link instead of booking it", async () => {
    const conn = await connection();
    const invoiceId = await invoice();
    const made = await makeLink(conn, invoiceId);
    conn.shop.pay(await plink(made.id), { at: PAID_AT });
    conn.shop.pay(await plink(made.id), { at: "2026-06-16T15:00:00Z", force: true }); // two customers got through before the page closed
    expect(await collect(conn)).toMatchObject({ paid: 1, extra: 1, review: 0 });
    expect(await count("online_payment WHERE link_id = $1", [made.id])).toBe(1);
    expect(await open(invoiceId)).toBe(0n);
    expect((await linkRow(made.id)).status).toBe("PAID");
  });

  it("goes on with the other links when one answer is unusable, and stops when the key is refused", async () => {
    let broken = "";
    let revoked = false;
    const conn = await connection({
      onRequest: (url) => {
        if (revoked) return { status: 401, body: { error: { message: "Invalid API Key provided: sk_live_***" } } };
        return broken && url.pathname === "/v1/checkout/sessions" && url.searchParams.get("payment_link") === broken ? { status: 200, body: { unexpected: true } } : undefined;
      },
    });
    const first = await makeLink(conn, await invoice());
    const second = await makeLink(conn, await invoice());
    conn.shop.pay(await plink(second.id), { at: PAID_AT });
    broken = await plink(first.id);

    expect(await collect(conn)).toMatchObject({ checked: 1, paid: 1, failed: 1 });
    expect(await linkRow(first.id)).toMatchObject({ status: "ACTIVE", last_error: "integrations.invalidResponse" });
    expect((await linkRow(second.id)).status).toBe("PAID");

    broken = "";
    const third = await makeLink(conn, await invoice());
    conn.shop.pay(await plink(third.id), { at: PAID_AT });
    revoked = true;
    expect(await refusal(collect(conn))).toBe("integrations.unauthorized");
    expect((await linkRow(third.id)).status).toBe("ACTIVE");
    expect(await count("online_payment WHERE link_id = $1", [third.id])).toBe(0);
  });

  it("is for the owner of this company, and calls nobody for anyone else", async () => {
    const conn = await connection();
    const made = await makeLink(conn, await invoice());
    conn.shop.pay(await plink(made.id), { at: PAID_AT });
    conn.calls.length = 0;
    for (const who of [accountant, reader]) expect(await refusal(collect(conn, who))).toBe("forbidden");
    expect(await refusal(collect(conn, otherOwner))).toBe("integrations.notFound");
    expect(await refusal(collectPayments(actor, { connectionId: "pas-un-id" }, conn.deps))).toBe("onlinePayments.invalid");
    expect(conn.calls).toHaveLength(0);
    expect(await count("online_payment WHERE link_id = $1", [made.id])).toBe(0);
  });

  it("does nothing when there is nothing to look at", async () => {
    const conn = await connection();
    expect(await collect(conn)).toEqual({ checked: 0, paid: 0, review: 0, extra: 0, waiting: 0, failed: 0, more: false });
    expect(conn.calls).toHaveLength(0);
  });
});

describe("cancelling a link", () => {
  it("closes the page at the service, then marks the link cancelled", async () => {
    const conn = await connection();
    const made = await makeLink(conn, await invoice());
    conn.calls.length = 0;
    expect(await cancelPaymentLink(actor, made.id, conn.deps)).toEqual({ status: "CANCELLED", closedAtService: true });
    const [close] = posts(conn);
    expect(new URL(close!.url).pathname).toBe(`/v1/payment_links/${await plink(made.id)}`);
    expect(new URLSearchParams(close!.body).get("active")).toBe("false");
    expect(conn.shop.links.get(await plink(made.id))?.active).toBe(false);
    expect((await linkRow(made.id)).status).toBe("CANCELLED");
    // again: nothing more to do
    conn.calls.length = 0;
    expect(await cancelPaymentLink(actor, made.id, conn.deps)).toEqual({ status: "CANCELLED", closedAtService: true });
    expect(conn.calls).toHaveLength(0);
  });

  it("books a payment made a moment ago instead of hiding it behind the cancellation", async () => {
    const conn = await connection();
    const invoiceId = await invoice();
    const made = await makeLink(conn, invoiceId);
    conn.shop.pay(await plink(made.id), { at: PAID_AT });
    expect(await cancelPaymentLink(actor, made.id, conn.deps)).toEqual({ status: "PAID", closedAtService: true });
    expect(await open(invoiceId)).toBe(0n);
    expect(await refusal(cancelPaymentLink(actor, made.id, conn.deps))).toBe("onlinePayments.alreadyPaid");
  });

  it("does not hide a payment that could not be booked behind the cancellation", async () => {
    const conn = await connection();
    const invoiceId = await invoice();
    const made = await makeLink(conn, invoiceId);
    conn.shop.pay(await plink(made.id), { at: PAID_AT, settlement: "usd" });
    expect(await cancelPaymentLink(actor, made.id, conn.deps)).toEqual({ status: "REVIEW", closedAtService: true });
    expect(await linkRow(made.id)).toMatchObject({ status: "REVIEW", review_reason: "onlinePayments.settlementCurrency" });
    expect(await open(invoiceId)).toBe(TOTAL);
  });

  it("acknowledges a link under review without calling the service, and keeps the reason on file", async () => {
    const conn = await connection();
    const invoiceId = await invoice();
    const made = await makeLink(conn, invoiceId);
    await recordReceipt(actor, { invoiceId, amountCents: "5000", expectedOpenCents: String(TOTAL), date: "2026-06-14", accountId: W.bank, method: "EFT" }, { now: NOW });
    conn.shop.pay(await plink(made.id), { at: PAID_AT });
    await collect(conn);
    conn.calls.length = 0;
    expect(await cancelPaymentLink(actor, made.id, conn.deps)).toEqual({ status: "CANCELLED", closedAtService: true });
    expect(conn.calls).toHaveLength(0);
    expect(await linkRow(made.id)).toMatchObject({ status: "CANCELLED", review_reason: "payments.exceeds" });
  });

  it("cancels a pending link that never reached the service, and one whose connection was disconnected", async () => {
    let failLink = true;
    const conn = await connection({ onRequest: (url, init) => (failLink && init.method === "POST" && url.pathname === "/v1/payment_links" ? { status: 500, body: {} } : undefined) });
    const pendingInvoice = await invoice();
    await refusal(makeLink(conn, pendingInvoice));
    const pending = await one("SELECT id FROM payment_link WHERE invoice_id = $1", [pendingInvoice]);
    conn.calls.length = 0;
    expect(await cancelPaymentLink(actor, pending.id, conn.deps)).toEqual({ status: "CANCELLED", closedAtService: true });
    expect(conn.calls).toHaveLength(0);

    failLink = false;
    const live = await makeLink(conn, await invoice());
    await disconnect(actor, conn.id);
    conn.calls.length = 0;
    expect(await cancelPaymentLink(actor, live.id, conn.deps)).toEqual({ status: "CANCELLED", closedAtService: false }); // the page stays open at the service: the screen says so
    expect(conn.calls).toHaveLength(0);
  });

  it("is for the owner, and only of this company's links", async () => {
    const conn = await connection();
    const made = await makeLink(conn, await invoice());
    conn.calls.length = 0;
    for (const who of [accountant, reader]) expect(await refusal(cancelPaymentLink(who, made.id, conn.deps))).toBe("forbidden");
    expect(await refusal(cancelPaymentLink(otherOwner, made.id, conn.deps))).toBe("onlinePayments.notFound");
    expect(await refusal(cancelPaymentLink(actor, randomUUID(), conn.deps))).toBe("onlinePayments.notFound");
    expect(conn.calls).toHaveLength(0);
    expect((await linkRow(made.id)).status).toBe("ACTIVE");
  });
});

describe("whose links they are", () => {
  it("shows an invoice's links to the members of its company and to nobody else", async () => {
    const conn = await connection();
    const invoiceId = await invoice();
    const made = await makeLink(conn, invoiceId);
    for (const who of [actor, accountant, reader]) expect((await listInvoicePaymentLinks(who, invoiceId)).map((link) => link.id), who.userId).toEqual([made.id]);
    expect(await listInvoicePaymentLinks(otherOwner, invoiceId)).toEqual([]);
  });

  it("keeps every change of a link in the audit trail, without the key", async () => {
    const conn = await connection();
    const made = await makeLink(conn, await invoice());
    conn.shop.pay(await plink(made.id), { at: PAID_AT });
    await collect(conn);
    const trail = (await db.query("SELECT action, entity_type, after::text AS a FROM audit_log WHERE entity_id = $1 ORDER BY id", [made.id])).rows;
    expect(trail.map((row) => row.action)).toEqual(["row.insert", "row.update", "row.update", "row.update"]); // reserved, priced, active, paid
    expect(trail.every((row) => row.entity_type === "payment_link")).toBe(true);
    expect(trail.map((row) => row.a).join()).not.toContain(KEY);
    expect(await count("audit_log WHERE entity_type = 'online_payment' AND company_id = $1", [W.companyA])).toBeGreaterThan(0);
  });
});
