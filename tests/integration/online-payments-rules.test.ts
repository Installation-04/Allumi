import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cancelPaymentLink, createConnection, createPaymentLink, setFeeAccount } from "@/modules/integrations";
import { postManualEntry } from "@/modules/ledger";
import { recordReceipt } from "@/modules/payments";
import { getDraft, postInvoice, saveDraft } from "@/modules/sales";
import type { CompanyContext } from "@/platform/tenant";
import { owner } from "./helpers";
import { fakeHttp, stripeShop } from "./providers";
import { appClient, asAccountant, asOwnerA, asOwnerB, asReader, inContext, seedWorld, sqlstate, W, type Context } from "./world";

/**
 * The database side of the online payments: what a payment link may be, how it may change, and what an online payment
 * must agree with (its link, its receipt, its fee entry). The fixtures are made by the services and committed (a
 * posted invoice, a connection, a link, a receipt); each rule is then tried in a transaction under a user's context,
 * rolled back at the end, because a failed statement aborts the transaction.
 */
const actor: CompanyContext = { userId: W.userOwnerA, companyId: W.companyA };
const NOW = new Date("2026-12-31T12:00:00Z");
const KEY = `sk_live_${"AbCd1234Ef".repeat(3)}`;
const TOTAL = 11498n;
const FEE = 363n;

let db: pg.Client;
let app: pg.Client;
let accountCounter = 0;
let labelCounter = 0;
beforeAll(async () => {
  db = await owner();
  await seedWorld(db);
  await db.query("INSERT INTO number_sequence(company_id,key,next_value,prefix,padding) VALUES ($1,'JOURNAL_ENTRY',1,'J-',5),($1,'INVOICE',1,'F-',5),($1,'CREDIT_NOTE',1,'AV-',5),($1,'PAYMENT_RECEIVED',1,'E-',5)", [W.companyA]);
  app = await appClient();
});
afterAll(async () => {
  await app?.end();
  await db?.end();
});

const inTx = <T>(ctx: Context, fn: () => Promise<T>) => inContext(app, ctx, fn);
const refused = (ctx: Context, fn: () => Promise<unknown>) => sqlstate(() => inTx(ctx, fn));
const count = async (sql: string, args: unknown[] = []) => (await app.query(`SELECT count(*)::int AS n FROM ${sql}`, args)).rows[0].n as number;

async function bankAccount(): Promise<string> {
  const id = randomUUID();
  await db.query("INSERT INTO account (id, company_id, code, name_fr, name_en, type, subtype, updated_at) VALUES ($1, $2, $3, 'Stripe', 'Stripe', 'ASSET', 'BANK', now())", [id, W.companyA, `15${String(++accountCounter).padStart(2, "0")}`]);
  return id;
}
async function invoice(): Promise<string> {
  const id = await saveDraft(actor, { contactId: W.customer, issueDate: "2026-06-01", dueDate: "2026-12-01", lines: [{ description: "Service", quantity: "1", unitPrice: "100", accountId: W.sales, taxCodeId: W.taxCodeStandard }] });
  await postInvoice(actor, id, (await getDraft(actor, id))!.revision, "2026-06-01");
  return id;
}

/** A Stripe connection that can take payment pages (fee account set), made through the service against the fake. */
async function connection(over: { fee?: boolean } = {}) {
  const shop = stripeShop({ key: KEY, transactions: () => [] });
  const fake = fakeHttp(shop.handler);
  const account = await bankAccount();
  const { id } = await createConnection(actor, { provider: "STRIPE", label: `Stripe ${++labelCounter}`, accountId: account, importFrom: "2026-01-01", credentials: { apiKey: KEY } }, { http: fake.http, now: NOW });
  if (over.fee !== false) await setFeeAccount(actor, id, W.expenses);
  return { id, account, deps: { http: fake.http, now: NOW } };
}
type Conn = Awaited<ReturnType<typeof connection>>;

/** An invoice with a live link, and a receipt on the connection's account for the whole balance: what an online payment is made of. */
async function paid(conn: Conn, over: { receiptAccount?: string; receiptInvoice?: string } = {}) {
  const invoiceId = await invoice();
  const link = await createPaymentLink(actor, { invoiceId, connectionId: conn.id }, conn.deps);
  const receipt = await recordReceipt(actor, {
    invoiceId: over.receiptInvoice ?? invoiceId, amountCents: String(TOTAL), expectedOpenCents: String(TOTAL), date: "2026-06-15", accountId: over.receiptAccount ?? conn.account, method: "CREDIT_CARD",
  }, { now: NOW });
  return { invoiceId, linkId: link.id, paymentId: receipt.id };
}
async function feeEntry(conn: Conn, over: { debit?: bigint; credit?: bigint; extraLine?: boolean } = {}): Promise<string> {
  const { id } = await postManualEntry(actor, {
    date: "2026-06-15", kind: "MANUAL", memo: "Frais",
    lines: over.extraLine
      ? [
          // the fees are all there, but so is something else: an entry of four lines is not the fees
          { accountId: W.expenses, debitCents: FEE, creditCents: 0n },
          { accountId: conn.account, debitCents: 0n, creditCents: FEE },
          { accountId: W.bank, debitCents: 1n, creditCents: 0n },
          { accountId: W.capital, debitCents: 0n, creditCents: 1n },
        ]
      : [
          { accountId: W.expenses, debitCents: over.debit ?? FEE, creditCents: 0n },
          { accountId: conn.account, debitCents: 0n, creditCents: over.credit ?? over.debit ?? FEE },
        ],
  });
  return id;
}

type Link = { invoice: string; connection: string; amount?: bigint; currency?: string; status?: string };
const insertLink = async (l: Link): Promise<string> =>
  (await app.query(
    `INSERT INTO payment_link (id, company_id, invoice_id, connection_id, status, amount_cents, currency, created_by_id, updated_at)
     VALUES (gen_random_uuid(), app_tenant_id(), $1, $2, $3::payment_link_status, $4::bigint, $5, app_current_user_id(), now()) RETURNING id`,
    [l.invoice, l.connection, l.status ?? "PENDING", String(l.amount ?? TOTAL), l.currency ?? "CAD"],
  )).rows[0].id as string;
const activate = (id: string) => app.query("UPDATE payment_link SET status = 'ACTIVE', external_id = 'plink_' || $1, url = 'https://buy.stripe.com/test_x', updated_at = now() WHERE id = $1", [id.replace(/-/g, "")]);

type Online = { link: string; payment: string; fee?: string | null; gross?: bigint; feeCents?: bigint; currency?: string; ref?: string };
const insertOnline = async (o: Online) => {
  const gross = o.gross ?? TOTAL;
  const feeCents = o.feeCents ?? (o.fee === null ? 0n : FEE);
  await app.query(
    `INSERT INTO online_payment (id, company_id, link_id, provider_ref, payment_id, fee_entry_id, gross_cents, fee_cents, net_cents, currency, paid_at, created_by_id)
     VALUES (gen_random_uuid(), app_tenant_id(), $1, $2, $3, $4, $5::bigint, $6::bigint, ($5::bigint - $6::bigint), $7, now(), app_current_user_id())`,
    [o.link, o.ref ?? `cs_test_${randomUUID()}`, o.payment, o.fee ?? null, String(gross), String(feeCents), o.currency ?? "CAD"],
  );
};

describe("who may see and change a payment link", () => {
  it("lets only the owner make a link, and every member of the company see it", async () => {
    const conn = await connection();
    const invoiceId = await invoice();
    await inTx(asOwnerA, async () => {
      const id = await insertLink({ invoice: invoiceId, connection: conn.id });
      expect(await count("payment_link WHERE id = $1", [id])).toBe(1);
    });
    for (const ctx of [asAccountant, asReader]) expect(await refused(ctx, () => insertLink({ invoice: invoiceId, connection: conn.id })), JSON.stringify(ctx)).toBe("42501");

    const made = await createPaymentLink(actor, { invoiceId, connectionId: conn.id }, conn.deps);
    for (const ctx of [asOwnerA, asAccountant, asReader]) expect(await inTx(ctx, () => count("payment_link WHERE id = $1", [made.id])), JSON.stringify(ctx)).toBe(1);
    expect(await inTx(asOwnerB, () => count("payment_link"))).toBe(0);
    // only the owner moves it along
    for (const ctx of [asAccountant, asReader]) {
      expect(await inTx(ctx, async () => (await app.query("UPDATE payment_link SET last_error = 'integrations.failed' WHERE id = $1", [made.id])).rowCount), JSON.stringify(ctx)).toBe(0);
    }
  });

  it("is made for a posted invoice of the company, for at most its balance, in its currency, on a Stripe connection that can take it", async () => {
    const conn = await connection();
    const noFee = await connection({ fee: false });
    const invoiceId = await invoice();
    const draft = await saveDraft(actor, { contactId: W.customer, issueDate: "2026-06-01", dueDate: "2026-12-01", lines: [{ description: "Service", quantity: "1", unitPrice: "100", accountId: W.sales, taxCodeId: W.taxCodeStandard }] });
    const other = async (sql: string) => refused(asOwnerA, async () => { await app.query(sql); });
    expect(await inTx(asOwnerA, () => insertLink({ invoice: invoiceId, connection: conn.id, amount: TOTAL }))).toBeTruthy();
    const cases: [string, Link][] = [
      ["a draft", { invoice: draft, connection: conn.id }],
      ["more than the balance", { invoice: invoiceId, connection: conn.id, amount: TOTAL + 1n }],
      ["another currency", { invoice: invoiceId, connection: conn.id, currency: "USD" }],
      ["a connection without a fee account", { invoice: invoiceId, connection: noFee.id }],
      ["a status other than pending", { invoice: invoiceId, connection: conn.id, status: "ACTIVE" }],
    ];
    for (const [label, link] of cases) expect(await refused(asOwnerA, () => insertLink(link)), label).toBe("AL010");
    expect(await refused(asOwnerA, () => insertLink({ invoice: invoiceId, connection: conn.id, amount: 0n })), "nothing").toBe("23514");
    expect(await other("SELECT 1")).toBeNull();
    // a disabled connection and a PayPal one cannot take a page
    await db.query("UPDATE integration_connection SET status = 'DISABLED' WHERE id = $1", [noFee.id]);
    expect(await refused(asOwnerA, () => insertLink({ invoice: invoiceId, connection: noFee.id }))).toBe("AL010");
    const paypal = randomUUID();
    await db.query("INSERT INTO integration_connection (id, company_id, provider, label, account_id, fee_account_id, import_from, created_by_id, updated_at) VALUES ($1, $2, 'PAYPAL', 'PayPal', $3, $4, '2026-01-01', $5, now())", [paypal, W.companyA, conn.account, W.expenses, W.userOwnerA]);
    expect(await refused(asOwnerA, () => insertLink({ invoice: invoiceId, connection: paypal }))).toBe("AL010");
  });

  it("keeps one live link per invoice, and lets a cancelled one be replaced", async () => {
    const conn = await connection();
    const invoiceId = await invoice();
    expect(await refused(asOwnerA, async () => { await insertLink({ invoice: invoiceId, connection: conn.id }); await insertLink({ invoice: invoiceId, connection: conn.id }); })).toBe("23505");
    await inTx(asOwnerA, async () => {
      const first = await insertLink({ invoice: invoiceId, connection: conn.id });
      await app.query("UPDATE payment_link SET status = 'CANCELLED', updated_at = now() WHERE id = $1", [first]);
      await insertLink({ invoice: invoiceId, connection: conn.id });
      expect(await count("payment_link WHERE invoice_id = $1", [invoiceId])).toBe(2);
    });
  });
});

describe("how a payment link changes", () => {
  it("goes from pending to active with its address, once, and from active to paid, under review or cancelled", async () => {
    const conn = await connection();
    const invoiceId = await invoice();
    await inTx(asOwnerA, async () => {
      const id = await insertLink({ invoice: invoiceId, connection: conn.id });
      await app.query("UPDATE payment_link SET external_price_id = 'price_1', last_error = 'integrations.unavailable', updated_at = now() WHERE id = $1", [id]);
      await activate(id);
      await app.query("UPDATE payment_link SET status = 'REVIEW', review_reason = 'payments.exceeds', updated_at = now() WHERE id = $1", [id]);
      await app.query("UPDATE payment_link SET status = 'CANCELLED', updated_at = now() WHERE id = $1", [id]);
      expect((await app.query("SELECT status, review_reason FROM payment_link WHERE id = $1", [id])).rows[0]).toEqual({ status: "CANCELLED", review_reason: "payments.exceeds" });
    });
  });

  it("refuses the changes that are not on the way: skipping a step, going back, or moving a final link", async () => {
    const conn = await connection();
    const invoiceId = await invoice();
    const from = async (steps: string[], then: string): Promise<string | null> =>
      refused(asOwnerA, async () => {
        const id = await insertLink({ invoice: invoiceId, connection: conn.id });
        for (const step of steps) {
          if (step === "ACTIVE") await activate(id);
          else await app.query(`UPDATE payment_link SET status = '${step}', review_reason = ${step === "REVIEW" ? "'payments.exceeds'" : "NULL"}, updated_at = now() WHERE id = $1`, [id]);
        }
        await app.query(then, [id]);
      });
    const setStatus = (status: string, extra = "") => `UPDATE payment_link SET status = '${status}'${extra}, updated_at = now() WHERE id = $1`;
    expect(await from([], setStatus("REVIEW", ", external_id = 'plink_x', url = 'https://x.test/a', review_reason = 'payments.exceeds'")), "pending → review").toBe("AL010");
    expect(await from(["ACTIVE"], setStatus("PENDING", ", external_id = NULL, url = NULL")), "active → pending").toBe("AL010");
    expect(await from(["ACTIVE", "CANCELLED"], setStatus("ACTIVE")), "cancelled → active").toBe("AL010");
    expect(await from(["ACTIVE", "CANCELLED"], "UPDATE payment_link SET last_error = 'integrations.failed' WHERE id = $1"), "a cancelled link is final").toBe("AL010");
    expect(await from(["ACTIVE", "REVIEW"], setStatus("ACTIVE", ", review_reason = NULL")), "review → active").toBe("AL010");
    // paid only by an online payment
    expect(await from(["ACTIVE"], setStatus("PAID")), "paid with no online payment").toBe("AL010");
  });

  it("never changes what the link is for, or what ties it to the service once set", async () => {
    const conn = await connection();
    const invoiceId = await invoice();
    const other = await invoice();
    const again = (set: string) =>
      refused(asOwnerA, async () => {
        const id = await insertLink({ invoice: invoiceId, connection: conn.id });
        await activate(id);
        await app.query(`UPDATE payment_link SET ${set}, updated_at = now() WHERE id = $1`, [id]);
      });
    for (const set of ["amount_cents = 100", "currency = 'USD'", `invoice_id = '${other}'`, `connection_id = '${conn.id}'`, "created_by_id = gen_random_uuid()", `company_id = '${W.companyB}'`]) {
      expect(["42501", "AL010", "23503"], set).toContain(await again(set));
    }
    expect(await again("amount_cents = 100")).toBe("42501"); // not even a column the application may name
    expect(await again("external_id = 'plink_other'")).toBe("AL010");
    expect(await again("url = 'https://buy.stripe.com/other'")).toBe("AL010");
    expect(await again("external_price_id = 'price_other'")).toBeNull(); // first time: the price was not set yet
  });

  it("keeps a code as the error and the reason, an https address, and a state that agrees with its columns", async () => {
    const conn = await connection();
    const invoiceId = await invoice();
    const update = (set: string, activated = true) =>
      refused(asOwnerA, async () => {
        const id = await insertLink({ invoice: invoiceId, connection: conn.id });
        if (activated) await activate(id);
        await app.query(`UPDATE payment_link SET ${set}, updated_at = now() WHERE id = $1`, [id]);
      });
    expect(await update("last_error = 'integrations.unauthorized'")).toBeNull();
    for (const set of ["last_error = 'Invalid API Key provided: sk_live_x'", "last_error = ''", "review_reason = 'because of the key'"]) expect(await update(set), set).toBe("23514");
    expect(await update("status = 'ACTIVE', external_id = 'plink_a b', url = 'https://x.test/a'", false), "a blank in an id").toBe("23514");
    expect(await update("status = 'ACTIVE', external_id = 'plink_a', url = 'http://buy.stripe.com/x'", false), "http").toBe("23514");
    expect(await update("status = 'ACTIVE', external_id = 'plink_a'", false), "no address").toBe("23514");
    expect(await update("status = 'ACTIVE'", false), "active with nothing").toBe("23514");
    expect(await update("status = 'REVIEW'"), "review with no reason").toBe("23514");
  });

  it("is never deleted", async () => {
    const conn = await connection();
    const invoiceId = await invoice();
    expect(await refused(asOwnerA, async () => { const id = await insertLink({ invoice: invoiceId, connection: conn.id }); await app.query("DELETE FROM payment_link WHERE id = $1", [id]); })).toBe("42501");
    await db.query("BEGIN");
    try {
      expect(await sqlstate(() => db.query("DELETE FROM payment_link"))).toBe("AL010");
    } finally {
      await db.query("ROLLBACK");
    }
  });
});

describe("what an online payment must agree with", () => {
  it("is added for an active link, with its receipt applied to the invoice and its fee entry, and then the link is paid", async () => {
    const conn = await connection();
    const p = await paid(conn);
    const fee = await feeEntry(conn);
    await inTx(asOwnerA, async () => {
      await insertOnline({ link: p.linkId, payment: p.paymentId, fee });
      await app.query("UPDATE payment_link SET status = 'PAID', updated_at = now() WHERE id = $1", [p.linkId]);
      expect(await count("online_payment WHERE link_id = $1", [p.linkId])).toBe(1);
    });
    // without fees, no entry
    const free = await paid(conn);
    await inTx(asOwnerA, () => insertOnline({ link: free.linkId, payment: free.paymentId, fee: null }));
  });

  it("is for the owner to add, and for every member to read", async () => {
    const conn = await connection();
    const p = await paid(conn);
    const fee = await feeEntry(conn);
    for (const ctx of [asAccountant, asReader]) expect(await refused(ctx, () => insertOnline({ link: p.linkId, payment: p.paymentId, fee })), JSON.stringify(ctx)).toBe("42501");
    await app.query("BEGIN");
    try {
      await app.query("SELECT set_config('app.user_id', $1, true), set_config('app.company_id', $2, true)", [W.userOwnerA, W.companyA]);
      await insertOnline({ link: p.linkId, payment: p.paymentId, fee });
      await app.query("COMMIT");
    } catch (error) {
      await app.query("ROLLBACK");
      throw error;
    }
    for (const ctx of [asOwnerA, asAccountant, asReader]) expect(await inTx(ctx, () => count("online_payment WHERE link_id = $1", [p.linkId])), JSON.stringify(ctx)).toBe(1);
    expect(await inTx(asOwnerB, () => count("online_payment"))).toBe(0);
  });

  it("refuses an amount or a currency that is not the link's", async () => {
    const conn = await connection();
    const p = await paid(conn);
    const fee = await feeEntry(conn);
    expect(await refused(asOwnerA, () => insertOnline({ link: p.linkId, payment: p.paymentId, fee, gross: TOTAL - 1n })), "gross").toBe("AL010");
    expect(await refused(asOwnerA, () => insertOnline({ link: p.linkId, payment: p.paymentId, fee, currency: "USD" })), "currency").toBe("AL010");
    expect(await refused(asOwnerA, () => insertOnline({ link: p.linkId, payment: p.paymentId, fee, feeCents: TOTAL + 1n })), "fee beyond the gross").toBe("AL010");
    expect(await refused(asOwnerA, () => insertOnline({ link: p.linkId, payment: p.paymentId, fee: null, feeCents: FEE })), "fees with no entry").toBe("23514");
    expect(await refused(asOwnerA, () => insertOnline({ link: p.linkId, payment: p.paymentId, fee, feeCents: 0n })), "an entry with no fees").toBe("AL010");
  });

  it("refuses a receipt that is not on the account of the connection, or not applied to the invoice of the link", async () => {
    const conn = await connection();
    const fee = await feeEntry(conn);
    const elsewhere = await paid(conn, { receiptAccount: W.bank });
    expect(await refused(asOwnerA, () => insertOnline({ link: elsewhere.linkId, payment: elsewhere.paymentId, fee })), "another account").toBe("AL010");

    // the receipt of another invoice, for the same amount
    const target = await invoice();
    const targetLink = await createPaymentLink(actor, { invoiceId: target, connectionId: conn.id }, conn.deps);
    const stranger = await invoice();
    const receipt = await recordReceipt(actor, { invoiceId: stranger, amountCents: String(TOTAL), expectedOpenCents: String(TOTAL), date: "2026-06-15", accountId: conn.account, method: "CREDIT_CARD" }, { now: NOW });
    expect(await refused(asOwnerA, () => insertOnline({ link: targetLink.id, payment: receipt.id, fee })), "another invoice").toBe("AL010");
    expect(await refused(asOwnerA, () => insertOnline({ link: targetLink.id, payment: randomUUID(), fee })), "no such payment").toBe("AL010");
  });

  it("refuses a fee entry that is not the fees: another amount, a stray pair of lines, or other accounts", async () => {
    const conn = await connection();
    const p = await paid(conn);
    for (const [label, entry] of [
      ["another amount", await feeEntry(conn, { debit: FEE + 1n })],
      ["a stray pair of lines", await feeEntry(conn, { extraLine: true })],
    ] as const) {
      expect(await refused(asOwnerA, () => insertOnline({ link: p.linkId, payment: p.paymentId, fee: entry })), label).toBe("AL010");
    }
    const sales = (await postManualEntry(actor, { date: "2026-06-15", kind: "MANUAL", memo: "Autre", lines: [{ accountId: W.bank, debitCents: FEE, creditCents: 0n }, { accountId: W.capital, debitCents: 0n, creditCents: FEE }] })).id;
    expect(await refused(asOwnerA, () => insertOnline({ link: p.linkId, payment: p.paymentId, fee: sales })), "other accounts").toBe("AL010");
    expect(await refused(asOwnerA, () => insertOnline({ link: p.linkId, payment: p.paymentId, fee: randomUUID() })), "no such entry").toBe("AL010");
  });

  it("is added for an active link only, and once per link, per receipt and per session", async () => {
    const conn = await connection();
    const p = await paid(conn);
    const fee = await feeEntry(conn);
    expect(await refused(asOwnerA, async () => { await insertOnline({ link: p.linkId, payment: p.paymentId, fee }); await insertOnline({ link: p.linkId, payment: p.paymentId, fee }); })).toBe("23505");
    const again = await paid(conn);
    expect(await refused(asOwnerA, async () => {
      await insertOnline({ link: p.linkId, payment: p.paymentId, fee, ref: "cs_test_same" });
      await insertOnline({ link: again.linkId, payment: again.paymentId, fee: null, ref: "cs_test_same" });
    })).toBe("23505");

    const cancelled = await paid(conn);
    await cancelPaymentLink(actor, cancelled.linkId, conn.deps);
    expect(await refused(asOwnerA, () => insertOnline({ link: cancelled.linkId, payment: cancelled.paymentId, fee: null })), "a cancelled link").toBe("AL010");
  });

  it("is never changed or deleted, even by the table owner", async () => {
    const conn = await connection();
    const p = await paid(conn);
    const fee = await feeEntry(conn);
    expect(await refused(asOwnerA, async () => {
      await insertOnline({ link: p.linkId, payment: p.paymentId, fee, ref: "cs_test_frozen" });
      await app.query("UPDATE online_payment SET fee_cents = 1 WHERE provider_ref = 'cs_test_frozen'");
    })).toBe("42501");
    expect(await refused(asOwnerA, async () => { await insertOnline({ link: p.linkId, payment: p.paymentId, fee, ref: "cs_test_frozen2" }); await app.query("DELETE FROM online_payment WHERE provider_ref = 'cs_test_frozen2'"); })).toBe("42501");
    await db.query("BEGIN");
    try {
      await db.query("INSERT INTO online_payment (id, company_id, link_id, provider_ref, payment_id, fee_entry_id, gross_cents, fee_cents, net_cents, currency, paid_at, created_by_id) VALUES (gen_random_uuid(), $1, $2, 'cs_test_owner', $3, $4, $5, $6, $7, 'CAD', now(), $8)", [W.companyA, p.linkId, p.paymentId, fee, String(TOTAL), String(FEE), String(TOTAL - FEE), W.userOwnerA]);
      await db.query("SAVEPOINT s");
      expect(await sqlstate(() => db.query("UPDATE online_payment SET fee_cents = 1"))).toBe("AL010");
      await db.query("ROLLBACK TO s");
      expect(await sqlstate(() => db.query("DELETE FROM online_payment"))).toBe("AL010");
    } finally {
      await db.query("ROLLBACK");
    }
  });
});

describe("where the processing fees go", () => {
  it("is an expense account of the company, set by the owner, and the only thing of a connection that may be set later", async () => {
    const conn = await connection({ fee: false });
    expect(await refused(asOwnerA, async () => { await app.query("UPDATE integration_connection SET fee_account_id = $2 WHERE id = $1", [conn.id, W.sales]); })).toBe("AL005");
    expect(await refused(asOwnerA, async () => { await app.query("UPDATE integration_connection SET fee_account_id = $2 WHERE id = $1", [conn.id, W.bank]); })).toBe("AL005");
    expect(await refused(asOwnerA, async () => { await app.query("UPDATE integration_connection SET fee_account_id = $2 WHERE id = $1", [conn.id, randomUUID()]); })).toBe("AL005");
    for (const ctx of [asAccountant, asReader]) {
      expect(await inTx(ctx, async () => (await app.query("UPDATE integration_connection SET fee_account_id = $2 WHERE id = $1", [conn.id, W.expenses])).rowCount), JSON.stringify(ctx)).toBe(0);
    }
    await inTx(asOwnerA, async () => {
      await app.query("UPDATE integration_connection SET fee_account_id = $2 WHERE id = $1", [conn.id, W.expenses]);
      expect((await app.query("SELECT fee_account_id FROM integration_connection WHERE id = $1", [conn.id])).rows[0].fee_account_id).toBe(W.expenses);
      const audit = await app.query("SELECT after FROM audit_log WHERE entity_type = 'integration_connection' AND entity_id = $1 ORDER BY id DESC LIMIT 1", [conn.id]);
      expect(audit.rows[0].after).toEqual({ fee_account_id: W.expenses });
    });
  });
});
