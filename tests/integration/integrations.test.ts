import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createConnection, disconnect, getConnection, listConnectionAccounts, listConnections, listImportedTransactions, replaceCredentials, setImportedStatus, syncConnection, type HttpClient } from "@/modules/integrations";
import { credentialBinding } from "@/modules/integrations/service/connections";
import { AppError } from "@/platform/errors";
import { decrypt } from "@/platform/secrets";
import type { CompanyContext } from "@/platform/tenant";
import { owner } from "./helpers";
import { fakeHttp, paypalHandler, PAYPAL_ORIGIN, stripeHandler, STRIPE_ORIGIN, stripeTxn, type Call, type PayPalTxn, type StripeTxn } from "./providers";
import { seedWorld, W } from "./world";

const actor: CompanyContext = { userId: W.userOwnerA, companyId: W.companyA };
const accountant: CompanyContext = { ...actor, userId: W.userAccountant };
const reader: CompanyContext = { ...actor, userId: W.userReader };
const otherOwner: CompanyContext = { userId: W.userOwnerB, companyId: W.companyB };
const NOW = new Date("2026-06-20T12:00:00Z");
const KEY = `sk_live_${"AbCd1234Ef".repeat(3)}`;
const TEST_KEY = `rk_test_${"Zy9Xw8Vu7T".repeat(3)}`;
const PP = { clientId: "AeA1QIZXiflr1_-r0U2UbWTziOWX1GRl2qs2-t1k", clientSecret: "EBWKjlELKMYqRNQ6sYvFo64FtaRLRR5BdHEESmha49TM" };
const sec = (iso: string) => Math.floor(Date.parse(iso) / 1000);

let db: pg.Client;
let accountCounter = 0;
beforeAll(async () => {
  db = await owner();
  await seedWorld(db);
});
afterAll(async () => { await db?.end(); });

/** A bank account of its own for each test: an imported transaction is unique per account, so tests do not meet. */
async function bankAccount(company: string = W.companyA): Promise<string> {
  const id = randomUUID();
  await db.query("INSERT INTO account (id, company_id, code, name_fr, name_en, type, subtype, updated_at) VALUES ($1, $2, $3, 'Stripe', 'Stripe', 'ASSET', 'BANK', now())", [id, company, `13${String(++accountCounter).padStart(2, "0")}`]);
  return id;
}

async function refusal(promise: Promise<unknown>): Promise<string> {
  try { await promise; } catch (error) { if (error instanceof AppError) return error.key; throw error; }
  throw new Error("expected a refusal");
}

let labelCounter = 0;
async function stripeConnection(handlerOptions: { key?: string; transactions?: () => StripeTxn[]; onList?: Parameters<typeof stripeHandler>[0]["onList"] } = {}, over: { importFrom?: string; account?: string } = {}) {
  const key = handlerOptions.key ?? KEY;
  const fake = fakeHttp(stripeHandler({ key, transactions: handlerOptions.transactions ?? (() => []), onList: handlerOptions.onList }));
  const account = over.account ?? (await bankAccount());
  const { id } = await createConnection(actor, { provider: "STRIPE", label: `Stripe ${++labelCounter}`, accountId: account, importFrom: over.importFrom ?? "2026-01-01", credentials: { apiKey: key } }, { http: fake.http, now: NOW });
  fake.calls.length = 0; // from here on, only the sync's own requests
  return { id, account, ...fake };
}
const sync = (id: string, http: HttpClient, who: CompanyContext = actor, now: Date = NOW) => syncConnection(who, id, { http, now });
const rows = async (connectionId: string) => (await db.query("SELECT * FROM bank_transaction WHERE connection_id = $1 ORDER BY txn_date, external_id", [connectionId])).rows;
const connectionRow = async (id: string) => (await db.query("SELECT * FROM integration_connection WHERE id = $1", [id])).rows[0];
const windowsOf = (calls: Call[]) => calls.filter((c) => c.url.includes("created%5Bgte%5D")).map((c) => { const u = new URL(c.url); return { gte: Number(u.searchParams.get("created[gte]")), lt: Number(u.searchParams.get("created[lt]")), after: u.searchParams.get("starting_after") }; });

describe("connecting a service", () => {
  it("checks the keys with the service, then stores them encrypted and bound to the connection", async () => {
    const fake = fakeHttp(stripeHandler({ key: KEY, transactions: () => [] }));
    const account = await bankAccount();
    const { id } = await createConnection(actor, { provider: "STRIPE", label: "Boutique", accountId: account, importFrom: "2026-01-01", credentials: { apiKey: KEY } }, { http: fake.http, now: NOW });

    // one call to prove the key; the key travels in a header, never in a URL
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toMatchObject({ method: "GET", headers: expect.objectContaining({ Authorization: `Bearer ${KEY}` }) });
    expect(fake.calls[0]?.url).toBe(`${STRIPE_ORIGIN}/v1/balance_transactions?limit=1`);

    expect(await connectionRow(id)).toMatchObject({ provider: "STRIPE", label: "Boutique", account_id: account, status: "ACTIVE", sandbox: false, credentials_hint: KEY.slice(-4), created_by_id: W.userOwnerA });
    const stored = (await db.query("SELECT credentials_enc FROM integration_credential WHERE connection_id = $1", [id])).rows[0].credentials_enc as Buffer;
    for (const form of [stored.toString("latin1"), stored.toString("hex"), stored.toString("base64")]) expect(form).not.toContain(KEY);
    expect(JSON.parse(decrypt(stored, credentialBinding(W.companyA, id)))).toEqual({ apiKey: KEY });
    expect(() => decrypt(stored, credentialBinding(W.companyA, randomUUID()))).toThrow(); // not another connection's
    expect(() => decrypt(stored, credentialBinding(W.companyB, id))).toThrow(); // not another company's
    // neither the key nor the ciphertext is in the audit trail
    const audit = (await db.query("SELECT before::text AS b, after::text AS a FROM audit_log WHERE entity_type IN ('integration_connection', 'integration_credential')")).rows.map((row) => `${row.b}${row.a}`).join();
    for (const needle of [KEY, stored.toString("hex"), stored.toString("base64")]) expect(audit).not.toContain(needle);
    // and a reader sees the connection without any of it
    const seen = JSON.stringify(await getConnection(reader, id, { now: NOW }), (_, value) => (typeof value === "bigint" ? value.toString() : value));
    expect(seen).toContain(KEY.slice(-4));
    expect(seen).not.toContain(KEY);
  });

  it("tells a test key from a live one", async () => {
    const fake = fakeHttp(stripeHandler({ key: TEST_KEY, transactions: () => [] }));
    const { id } = await createConnection(actor, { provider: "STRIPE", label: "Essai", accountId: await bankAccount(), importFrom: "2026-01-01", credentials: { apiKey: TEST_KEY } }, { http: fake.http, now: NOW });
    expect((await connectionRow(id)).sandbox).toBe(true);
    expect((await getConnection(actor, id, { now: NOW }))?.sandbox).toBe(true);
  });

  it("is for the owner, and calls nobody for anyone else", async () => {
    for (const who of [accountant, reader]) {
      const fake = fakeHttp(stripeHandler({ key: KEY, transactions: () => [] }));
      expect(await refusal(createConnection(who, { provider: "STRIPE", label: "Non", accountId: W.bank, importFrom: "2026-01-01", credentials: { apiKey: KEY } }, { http: fake.http, now: NOW }))).toBe("forbidden");
      expect(fake.calls).toHaveLength(0);
    }
  });

  it("refuses what cannot be a connection before calling anyone", async () => {
    const account = await bankAccount();
    const ok = { provider: "STRIPE", label: "Valide", accountId: account, importFrom: "2026-01-01", credentials: { apiKey: KEY } };
    const cases: [string, object, string][] = [
      ["unknown service", { provider: "SQUARE" }, "integrations.invalid"],
      ["blank label", { label: "   " }, "integrations.invalid"],
      ["long label", { label: "x".repeat(61) }, "integrations.invalid"],
      ["not an account id", { accountId: "banque" }, "integrations.invalid"],
      ["a publishable key", { credentials: { apiKey: `pk_live_${"a".repeat(30)}` } }, "integrations.invalid"],
      ["no key", { credentials: {} }, "integrations.invalid"],
      ["a date that is not one", { importFrom: "2026-02-30" }, "integrations.importFrom"],
      ["a date in the future", { importFrom: "2026-06-21" }, "integrations.importFrom"],
      ["a date before 2000", { importFrom: "1999-12-31" }, "integrations.importFrom"],
      ["a revenue account", { accountId: W.sales }, "integrations.account"],
      ["the receivables account", { accountId: W.receivable }, "integrations.account"],
      ["another company's bank", { accountId: W.bankB }, "integrations.account"],
    ];
    for (const [label, over, key] of cases) {
      const fake = fakeHttp(stripeHandler({ key: KEY, transactions: () => [] }));
      expect(await refusal(createConnection(actor, { ...ok, ...over }, { http: fake.http, now: NOW })), label).toBe(key);
      expect(fake.calls, label).toHaveLength(0);
    }
  });

  it("stores nothing when the service refuses, and keeps its words out of the error", async () => {
    const attempts: [string, Parameters<typeof fakeHttp>[0], string][] = [
      ["wrong key", (_url, _init) => ({ status: 401, body: { error: { message: `Invalid API Key provided: ${KEY}` } } }), "integrations.unauthorized"],
      ["no permission", () => ({ status: 403, body: {} }), "integrations.forbidden"],
      ["rate limited", () => ({ status: 429, body: {} }), "integrations.rateLimited"],
      ["service down", () => ({ status: 503, body: {} }), "integrations.unavailable"],
      ["not found", () => ({ status: 404, body: {} }), "integrations.invalidResponse"],
      ["not JSON", () => ({ status: 200, raw: "<html>maintenance</html>" }), "integrations.invalidResponse"],
    ];
    for (const [label, handler, key] of attempts) {
      const { http } = fakeHttp(handler);
      const name = `Refusée ${label}`;
      const error = await createConnection(actor, { provider: "STRIPE", label: name, accountId: await bankAccount(), importFrom: "2026-01-01", credentials: { apiKey: KEY } }, { http, now: NOW }).catch((e: unknown) => e);
      expect(error, label).toBeInstanceOf(AppError);
      expect((error as AppError).key, label).toBe(key);
      expect(String((error as AppError).message), label).not.toContain(KEY);
      expect((await db.query("SELECT 1 FROM integration_connection WHERE label = $1", [name])).rowCount, label).toBe(0);
    }
    const down: HttpClient = async () => { throw new Error("connect ECONNREFUSED"); };
    expect(await refusal(createConnection(actor, { provider: "STRIPE", label: "Réseau", accountId: await bankAccount(), importFrom: "2026-01-01", credentials: { apiKey: KEY } }, { http: down, now: NOW }))).toBe("integrations.unavailable");
  });

  it("keeps a label unique for a service", async () => {
    const { http } = fakeHttp(stripeHandler({ key: KEY, transactions: () => [] }));
    const input = { provider: "STRIPE", label: "Unique", accountId: await bankAccount(), importFrom: "2026-01-01", credentials: { apiKey: KEY } };
    await createConnection(actor, input, { http, now: NOW });
    expect(await refusal(createConnection(actor, input, { http, now: NOW }))).toBe("integrations.labelTaken");
  });

  it("connects PayPal on the live or the sandbox host, with the client id and secret as Basic authentication", async () => {
    for (const environment of ["live", "sandbox"] as const) {
      const origin = PAYPAL_ORIGIN[environment];
      const fake = fakeHttp(paypalHandler({ origin, ...PP, transactions: () => [] }));
      const { id } = await createConnection(actor, { provider: "PAYPAL", label: `PayPal ${environment}`, accountId: await bankAccount(), importFrom: "2026-01-01", environment, credentials: PP }, { http: fake.http, now: NOW });
      expect(fake.calls.map((c) => new URL(c.url).origin)).toEqual([origin, origin]); // the token, then one report
      expect(fake.calls[0]).toMatchObject({ method: "POST", body: "grant_type=client_credentials" });
      for (const call of fake.calls) expect(call.url).not.toContain(PP.clientSecret);
      expect(await connectionRow(id)).toMatchObject({ provider: "PAYPAL", sandbox: environment === "sandbox", credentials_hint: PP.clientId.slice(-4) });
    }
    // PayPal's reporting keeps three years
    const { http } = fakeHttp(paypalHandler({ origin: PAYPAL_ORIGIN.live, ...PP, transactions: () => [] }));
    expect(await refusal(createConnection(actor, { provider: "PAYPAL", label: "Trop loin", accountId: await bankAccount(), importFrom: "2022-01-01", credentials: PP }, { http, now: NOW }))).toBe("integrations.importFrom");
    // a wrong secret is refused by the token endpoint
    const wrong = fakeHttp(paypalHandler({ origin: PAYPAL_ORIGIN.live, ...PP, transactions: () => [] }));
    expect(await refusal(createConnection(actor, { provider: "PAYPAL", label: "Mauvais secret", accountId: await bankAccount(), importFrom: "2026-01-01", credentials: { ...PP, clientSecret: "x".repeat(40) } }, { http: wrong.http, now: NOW }))).toBe("integrations.unauthorized");
  });

  it("lists the connections and the accounts they can use", async () => {
    expect((await listConnections(reader, { now: NOW })).length).toBeGreaterThan(0);
    expect(await listConnections(otherOwner, { now: NOW })).toEqual([]);
    const accounts = await listConnectionAccounts(reader);
    expect(accounts.every((account) => account.code !== "4000")).toBe(true);
    expect(accounts.map((account) => account.id)).toContain(W.bank);
    expect(accounts.map((account) => account.id)).not.toContain(W.undeposited);
  });
});

describe("importing Stripe transactions", () => {
  // January to June: busy first week (pagination), a yen charge (no cents), a refund and a payout.
  const history = (): StripeTxn[] => [
    ...Array.from({ length: 250 }, (_, i) => stripeTxn({ id: `txn_busy_${String(i).padStart(3, "0")}`, created: sec("2026-01-02T15:00:00Z") + i * 60, amount: 1000 + i, fee: 59 })),
    stripeTxn({ id: "txn_yen_001", created: sec("2026-02-10T15:00:00Z"), currency: "jpy", amount: 5000, fee: 180 }),
    stripeTxn({ id: "txn_refund_001", created: sec("2026-03-15T15:00:00Z"), amount: -5000, fee: 0, type: "refund", reporting_category: "refund", description: "Remboursement" }),
    stripeTxn({ id: "txn_payout_001", created: sec("2026-06-10T15:00:00Z"), amount: -9680, fee: 0, type: "payout", reporting_category: "payout", description: "STRIPE PAYOUT", source: "po_1" }),
    stripeTxn({ id: "txn_future_001", created: sec("2026-06-21T15:00:00Z") }), // after the sync: not yet
  ];

  it("reads every window and every page, into the connection's account, with gross, fee and net", async () => {
    const c = await stripeConnection({ transactions: history });
    const result = await sync(c.id, c.http);
    expect(result).toMatchObject({ imported: 252, windows: 6, complete: true, skipped: { unsupportedCurrency: 1, notSettled: 0 } });

    const all = await rows(c.id);
    expect(all).toHaveLength(252);
    expect(all.every((row) => row.account_id === c.account && row.status === "UNMATCHED" && row.connection_id === c.id)).toBe(true);
    const refund = all.find((row) => row.external_id === "stripe:txn_refund_001");
    expect(refund).toMatchObject({ source_type: "refund", description: "Remboursement", currency: "CAD", dedupe_key: "stripe:txn_refund_001" });
    expect([refund.amount_cents, refund.gross_cents, refund.fee_cents]).toEqual(["-5000", "-5000", "0"]);
    expect(refund.provider_details).toMatchObject({ kind: "REFUND", reportingCategory: "refund", rawAmount: -5000 });
    const busy = all.find((row) => row.external_id === "stripe:txn_busy_007");
    expect([busy.amount_cents, busy.gross_cents, busy.fee_cents]).toEqual(["948", "1007", "59"]); // 1007 − 59
    expect(all.some((row) => row.external_id.includes("yen") || row.external_id.includes("future"))).toBe(false);
    for (const row of all) expect(BigInt(row.gross_cents) - BigInt(row.fee_cents)).toBe(BigInt(row.amount_cents));

    // the requests: only Stripe, only the list, consecutive windows from the first day asked for
    expect(c.calls.every((call) => call.url.startsWith(`${STRIPE_ORIGIN}/v1/balance_transactions?`) && call.headers.Authorization === `Bearer ${KEY}` && !call.url.includes(KEY))).toBe(true);
    const asked = windowsOf(c.calls).filter((w) => w.after === null);
    expect(asked[0]?.gte).toBe(sec("2026-01-01T00:00:00Z"));
    for (let i = 1; i < asked.length; i++) expect(asked[i]?.gte).toBe(asked[i - 1]?.lt);
    expect(asked.at(-1)?.lt).toBe(sec(NOW.toISOString()));
    expect(windowsOf(c.calls).filter((w) => w.after !== null).length).toBeGreaterThanOrEqual(2); // 250 in a window = 3 pages

    const state = await connectionRow(c.id);
    expect(state).toMatchObject({ last_sync_ok: true, last_error: null, last_imported_count: 252, syncing_since: null });
    expect(state.sync_cursor.toISOString()).toBe(NOW.toISOString());
  });

  it("imports nothing twice, and starts again a little before its cursor to catch what arrived late", async () => {
    // one record sits inside the overlap: the second sync reads it again and must leave it alone
    let data = [...history(), stripeTxn({ id: "txn_recent_001", created: sec("2026-06-19T08:00:00Z"), amount: 3000, fee: 117 })];
    const c = await stripeConnection({ transactions: () => data });
    expect(await sync(c.id, c.http)).toMatchObject({ imported: 253 });
    c.calls.length = 0;
    expect(await sync(c.id, c.http)).toMatchObject({ imported: 0, complete: true });
    expect(c.calls.some((call) => call.url.includes("balance_transactions"))).toBe(true);
    expect(await rows(c.id)).toHaveLength(253);
    expect((await db.query("SELECT count(*)::int AS n FROM bank_transaction WHERE external_id = 'stripe:txn_recent_001'")).rows[0].n).toBe(1);
    expect(windowsOf(c.calls)[0]?.gte).toBe(sec(NOW.toISOString()) - 2 * 86_400); // cursor − the overlap
    expect(await connectionRow(c.id)).toMatchObject({ last_sync_ok: true, last_imported_count: 0 });

    // a record that shows up late, dated before the last sync
    data = [...data, stripeTxn({ id: "txn_late_001", created: sec("2026-06-19T10:00:00Z"), amount: 2000, fee: 88 })];
    expect(await sync(c.id, c.http)).toMatchObject({ imported: 1 });
    expect((await rows(c.id)).find((row) => row.external_id === "stripe:txn_late_001")?.amount_cents).toBe("1912");
    expect(await rows(c.id)).toHaveLength(254);
  });

  it("stores a window with its cursor or not at all, and resumes where it stopped", async () => {
    let broken = true;
    const data = [
      stripeTxn({ id: "txn_w1_001", created: sec("2026-01-05T10:00:00Z") }),
      stripeTxn({ id: "txn_w2_001", created: sec("2026-02-10T10:00:00Z") }),
      stripeTxn({ id: "txn_w3_001", created: sec("2026-03-15T10:00:00Z") }),
      stripeTxn({ id: "txn_w3_002", created: sec("2026-03-16T10:00:00Z") }),
    ];
    const c = await stripeConnection({
      transactions: () => data,
      // the third window (from 2026-03-04) carries a record whose figures do not add up
      onList: (url) => (broken && Number(url.searchParams.get("created[gte]")) >= sec("2026-03-04T00:00:00Z") ? { status: 200, body: { has_more: false, data: [{ ...stripeTxn({ id: "txn_bad_001", created: sec("2026-03-15T10:00:00Z") }), net: 1 }] } } : undefined),
    });
    expect(await refusal(sync(c.id, c.http))).toBe("integrations.invalidResponse");
    expect((await rows(c.id)).map((row) => row.external_id)).toEqual(["stripe:txn_w1_001", "stripe:txn_w2_001"]); // windows 1 and 2 are in; nothing of window 3
    const state = await connectionRow(c.id);
    expect(state).toMatchObject({ last_sync_ok: false, last_error: "integrations.invalidResponse", syncing_since: null });
    const cursor = state.sync_cursor as Date;
    expect(cursor.toISOString()).toBe("2026-03-04T00:00:00.000Z"); // the end of the second window

    broken = false;
    c.calls.length = 0;
    expect(await sync(c.id, c.http)).toMatchObject({ imported: 2, complete: true });
    expect((await rows(c.id)).map((row) => row.external_id)).toEqual(["stripe:txn_w1_001", "stripe:txn_w2_001", "stripe:txn_w3_001", "stripe:txn_w3_002"]);
    expect(windowsOf(c.calls)[0]?.gte).toBe(cursor.getTime() / 1000 - 2 * 86_400); // did not read windows 1 and 2 again
    expect(await connectionRow(c.id)).toMatchObject({ last_sync_ok: true, last_error: null });
  });

  it("keeps the service's own words out of everything it stores", async () => {
    const c = await stripeConnection({ transactions: history });
    const { http } = fakeHttp(() => ({ status: 401, body: { error: { message: `Invalid API Key provided: ${KEY}` } } }));
    expect(await refusal(sync(c.id, http))).toBe("integrations.unauthorized");
    expect((await connectionRow(c.id)).last_error).toBe("integrations.unauthorized");
    const everything = JSON.stringify([(await db.query("SELECT * FROM integration_connection")).rows, (await db.query("SELECT before, after FROM audit_log")).rows]);
    expect(everything).not.toContain(KEY);
    expect(everything).not.toContain("Invalid API Key");
  });

  it("runs one sync at a time per connection, and lets a dead run's lock expire", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let entered: () => void = () => undefined;
    const inside = new Promise<void>((resolve) => { entered = resolve; });
    const slow = fakeHttp(async (url, init, call) => {
      entered();
      await gate;
      return stripeHandler({ key: KEY, transactions: () => [] })(url, init, call);
    });
    const c = await stripeConnection();
    const first = sync(c.id, slow.http);
    await inside;
    expect(await refusal(sync(c.id, c.http))).toBe("integrations.busy");
    expect((await getConnection(actor, c.id, { now: new Date() }))?.syncing).toBe(true);
    release();
    await first;
    expect(await sync(c.id, c.http)).toMatchObject({ complete: true });

    // a run that died left its lock: ten minutes later another may start
    await db.query("UPDATE integration_connection SET syncing_since = now() - interval '9 minutes' WHERE id = $1", [c.id]);
    expect(await refusal(sync(c.id, c.http))).toBe("integrations.busy");
    await db.query("UPDATE integration_connection SET syncing_since = now() - interval '11 minutes' WHERE id = $1", [c.id]);
    expect(await sync(c.id, c.http)).toMatchObject({ complete: true });
    expect((await connectionRow(c.id)).syncing_since).toBeNull();
  });

  it("is for the owner of the company that holds the connection", async () => {
    const c = await stripeConnection();
    const calls = () => c.calls.length;
    for (const who of [accountant, reader]) expect(await refusal(sync(c.id, c.http, who))).toBe("forbidden");
    expect(await refusal(sync(c.id, c.http, otherOwner))).toBe("integrations.notFound");
    expect(await refusal(sync(randomUUID(), c.http))).toBe("integrations.notFound");
    expect(calls()).toBe(0);
  });

  it("stops importing when disconnected, and resumes when reconnected with keys of the same environment", async () => {
    const c = await stripeConnection({ transactions: history });
    await sync(c.id, c.http);
    await disconnect(actor, c.id);
    const state = await connectionRow(c.id);
    expect(state).toMatchObject({ status: "DISABLED", credentials_hint: null });
    expect((await db.query("SELECT credentials_enc FROM integration_credential WHERE connection_id = $1", [c.id])).rows[0].credentials_enc).toBeNull();
    expect(await rows(c.id)).toHaveLength(252); // what was imported stays
    expect(await refusal(sync(c.id, c.http))).toBe("integrations.disabled");

    expect(await refusal(replaceCredentials(actor, c.id, { apiKey: TEST_KEY }, { http: fakeHttp(stripeHandler({ key: TEST_KEY, transactions: () => [] })).http, now: NOW }))).toBe("integrations.environment");
    expect(await refusal(replaceCredentials(actor, c.id, { apiKey: "pas une clé" }, { http: c.http, now: NOW }))).toBe("integrations.invalid");
    expect(await refusal(replaceCredentials(accountant, c.id, { apiKey: KEY }, { http: c.http, now: NOW }))).toBe("forbidden");
    expect(await refusal(replaceCredentials(actor, randomUUID(), { apiKey: KEY }, { http: c.http, now: NOW }))).toBe("integrations.notFound");
    const rotated = `sk_live_${"Qw3rTy9Op1".repeat(3)}`;
    await replaceCredentials(actor, c.id, { apiKey: rotated }, { http: fakeHttp(stripeHandler({ key: rotated, transactions: history })).http, now: NOW });
    expect(await connectionRow(c.id)).toMatchObject({ status: "ACTIVE", credentials_hint: rotated.slice(-4), last_error: null });
    const again = fakeHttp(stripeHandler({ key: rotated, transactions: history }));
    expect(await sync(c.id, again.http)).toMatchObject({ imported: 0, complete: true });
  });

  it("will not use a credential blob that was moved to another connection", async () => {
    const a = await stripeConnection();
    const b = await stripeConnection();
    const blob = (await db.query("SELECT credentials_enc FROM integration_credential WHERE connection_id = $1", [a.id])).rows[0].credentials_enc;
    await db.query("UPDATE integration_credential SET credentials_enc = $1 WHERE connection_id = $2", [blob, b.id]);
    expect(await refusal(sync(b.id, b.http))).toBe("integrations.credentials");
    expect(b.calls).toHaveLength(0); // nothing was sent with it
    expect(await connectionRow(b.id)).toMatchObject({ last_sync_ok: false, last_error: "integrations.credentials", syncing_since: null });
  });

  it("reads a long history over several runs, never more than 24 windows at a time", async () => {
    const c = await stripeConnection({ transactions: () => [stripeTxn({ id: "txn_old_001", created: sec("2024-02-01T10:00:00Z") }), stripeTxn({ id: "txn_new_001", created: sec("2026-05-01T10:00:00Z") })] }, { importFrom: "2024-01-01" });
    const first = await sync(c.id, c.http);
    expect(first).toMatchObject({ windows: 24, complete: false });
    const cursor = (await connectionRow(c.id)).sync_cursor as Date;
    expect(cursor.toISOString().slice(0, 10)).toBe("2026-01-14"); // 24 windows of 31 days after 2024-01-01 (744 days)
    const second = await sync(c.id, c.http);
    expect(second).toMatchObject({ complete: true });
    expect((await rows(c.id)).map((row) => row.external_id)).toEqual(["stripe:txn_old_001", "stripe:txn_new_001"]);
  });

  it("cuts in two a window that holds more than a run can read, and imports only what is real", async () => {
    const real = [stripeTxn({ id: "txn_real_001", created: sec("2026-06-01T10:00:00Z") }), stripeTxn({ id: "txn_real_002", created: sec("2026-06-18T10:00:00Z") })];
    let filler = 0;
    const c = await stripeConnection({
      transactions: () => real,
      // any request for more than three days is answered with an endless list
      onList: (url) => (Number(url.searchParams.get("created[lt]")) - Number(url.searchParams.get("created[gte]")) > 3 * 86_400
        ? { status: 200, body: { has_more: true, data: Array.from({ length: 100 }, () => stripeTxn({ id: `txn_filler_${++filler}`, created: sec("2026-06-05T10:00:00Z") })) } }
        : undefined),
    }, { importFrom: "2026-05-21" });
    const result = await sync(c.id, c.http);
    expect(result).toMatchObject({ imported: 2, complete: true });
    expect((await rows(c.id)).map((row) => row.external_id)).toEqual(["stripe:txn_real_001", "stripe:txn_real_002"]);
    expect(filler).toBeGreaterThan(0);
  });
});

describe("importing PayPal transactions", () => {
  const paypalHistory = (): PayPalTxn[] => [
    { id: "7WY54567JY234567N", code: "T0006", initiated: "2026-02-03T14:03:52+0000", amount: "465.00", fee: "-13.79", subject: "Facture F-00002", invoice: "F-00002" },
    { id: "1AB23456CD789012E", code: "T1107", initiated: "2026-03-09T09:00:00+0000", amount: "-465.00", fee: "13.79", subject: "Remboursement" },
    { id: "5XY12345ZZ000000A", code: "T0006", initiated: "2026-04-01T09:00:00+0000", amount: "50.00", fee: "-1.75", status: "P" }, // pending
    { id: "9QQ99999WW111111B", code: "T0006", initiated: "2026-04-02T09:00:00+0000", amount: "5000", currency: "JPY" },
    { id: "3MN77777KK222222C", code: "T0006", initiated: "2026-05-20T09:00:00+0000", amount: "20.00", fee: "0.60" }, // a fee of the unexpected sign
    ...Array.from({ length: 1100 }, (_, i) => ({ id: `BULK${String(i).padStart(12, "0")}`, code: "T0006", initiated: "2026-05-02T10:00:00+0000", amount: "10.00", fee: "-0.59" })),
  ];

  async function paypalConnection(environment: "live" | "sandbox" = "live", transactions: () => PayPalTxn[] = paypalHistory) {
    const origin = PAYPAL_ORIGIN[environment];
    const fake = fakeHttp(paypalHandler({ origin, ...PP, transactions }));
    const account = await bankAccount();
    const { id } = await createConnection(actor, { provider: "PAYPAL", label: `PayPal ${++labelCounter}`, accountId: account, importFrom: "2026-01-01", environment, credentials: PP }, { http: fake.http, now: NOW });
    fake.calls.length = 0;
    return { id, account, origin, ...fake };
  }

  it("asks for transaction_info only, in windows of at most 31 days, a token per run, and imports net amounts", async () => {
    const c = await paypalConnection();
    const result = await sync(c.id, c.http);
    expect(result).toMatchObject({ imported: 1100 + 3, complete: true, skipped: { notSettled: 1, unsupportedCurrency: 1 } });

    expect(c.calls.filter((call) => call.url.endsWith("/v1/oauth2/token"))).toHaveLength(1);
    const reports = c.calls.filter((call) => call.url.includes("/v1/reporting/transactions"));
    expect(reports.length).toBeGreaterThanOrEqual(6 + 2); // six windows, and the busy one has three pages
    for (const call of reports) {
      const u = new URL(call.url);
      expect(u.origin).toBe(c.origin);
      expect(u.searchParams.get("fields")).toBe("transaction_info"); // no payer, no shipping: no customer data comes in
      expect(u.searchParams.get("balance_affecting_records_only")).toBe("Y");
      expect(call.headers.Authorization).toBe("Bearer A21AAL-fake-access-token-0123456789");
    }

    const all = await rows(c.id);
    const payment = all.find((row) => row.external_id === "paypal:7WY54567JY234567N:T0006");
    expect(payment).toMatchObject({ source_type: "T0006", description: "Facture F-00002", currency: "CAD" });
    expect([payment.amount_cents, payment.gross_cents, payment.fee_cents]).toEqual(["45121", "46500", "1379"]); // 465,00 − 13,79
    expect(payment.provider_details).toMatchObject({ kind: "PAYMENT", reference: "F-00002", rawAmount: "465.00", rawFee: "-13.79", unusualFeeSign: false });
    const refund = all.find((row) => row.external_id === "paypal:1AB23456CD789012E:T1107");
    expect([refund.amount_cents, refund.gross_cents, refund.fee_cents]).toEqual(["-45121", "-46500", "-1379"]);
    expect(all.find((row) => row.external_id === "paypal:3MN77777KK222222C:T0006")?.provider_details).toMatchObject({ unusualFeeSign: true });
    expect(all.some((row) => row.external_id.includes("5XY12345ZZ000000A") || row.external_id.includes("9QQ99999WW111111B"))).toBe(false);

    // again: nothing new
    expect(await sync(c.id, c.http)).toMatchObject({ imported: 0 });
    expect(await rows(c.id)).toHaveLength(1103);
  });

  it("uses the sandbox host for a sandbox connection", async () => {
    const c = await paypalConnection("sandbox", () => []);
    await sync(c.id, c.http);
    expect(c.calls.length).toBeGreaterThan(0);
    for (const call of c.calls) expect(new URL(call.url).origin).toBe(PAYPAL_ORIGIN.sandbox);
  });

  it("stops with a code when PayPal answers something that is not a transaction list", async () => {
    const origin = PAYPAL_ORIGIN.live;
    let broken = false;
    const fake = fakeHttp(paypalHandler({ origin, ...PP, transactions: paypalHistory, onReport: () => (broken ? { status: 200, body: { transaction_details: [{ transaction_info: { transaction_id: "X", transaction_amount: { currency_code: "CAD", value: "12,50" } } }] } } : undefined) }));
    const { id } = await createConnection(actor, { provider: "PAYPAL", label: `PayPal ${++labelCounter}`, accountId: await bankAccount(), importFrom: "2026-01-01", credentials: PP }, { http: fake.http, now: NOW });
    broken = true;
    expect(await refusal(sync(id, fake.http))).toBe("integrations.invalidResponse");
    expect(await rows(id)).toHaveLength(0);
    expect(await connectionRow(id)).toMatchObject({ last_sync_ok: false, last_error: "integrations.invalidResponse", syncing_since: null });
  });
});

describe("the inbox of imported transactions", () => {
  it("lists them newest first, 50 a page, with the filters, and flags what needs a look", async () => {
    const c = await stripeConnection({
      transactions: () => [
        ...Array.from({ length: 120 }, (_, i) => stripeTxn({ id: `txn_inbox_${String(i).padStart(3, "0")}`, created: sec("2026-05-01T10:00:00Z") + i * 3600, amount: 1000 + i, fee: 50 })),
        stripeTxn({ id: "txn_inbox_usd", created: sec("2026-06-01T10:00:00Z"), currency: "usd", amount: 2000, fee: 100 }),
      ],
    }, { importFrom: "2026-05-01" });
    await sync(c.id, c.http);

    const first = await listImportedTransactions(reader, { connectionId: c.id });
    expect(first).toMatchObject({ total: 121, page: 1, pageCount: 3 });
    expect(first.transactions).toHaveLength(50);
    const dates = first.transactions.map((t) => t.date);
    expect([...dates].sort().reverse()).toEqual(dates);
    expect(first.transactions[0]).toMatchObject({ date: "2026-06-01", currency: "USD", amountCents: 1900n, grossCents: 2000n, feeCents: 100n, status: "UNMATCHED", kind: "PAYMENT", provider: "STRIPE", sandbox: false, flagged: false, connectionId: c.id });
    expect((await listImportedTransactions(reader, { connectionId: c.id, page: 3 })).transactions).toHaveLength(21);
    expect((await listImportedTransactions(reader, { connectionId: c.id, page: 99 })).page).toBe(3);
    expect((await listImportedTransactions(reader, { connectionId: c.id, status: "EXCLUDED" })).total).toBe(0);
    expect((await listImportedTransactions(otherOwner, { connectionId: c.id })).total).toBe(0);
  });

  it("sets a transaction aside and brings it back, for owners and accountants only", async () => {
    const c = await stripeConnection({ transactions: () => [stripeTxn({ id: "txn_aside_001", created: sec("2026-06-01T10:00:00Z") })] });
    await sync(c.id, c.http);
    const id = (await listImportedTransactions(reader, { connectionId: c.id })).transactions[0]?.id ?? "";
    expect(await refusal(setImportedStatus(reader, id, "EXCLUDED"))).toBe("forbidden");
    await setImportedStatus(accountant, id, "EXCLUDED");
    expect((await listImportedTransactions(reader, { connectionId: c.id, status: "EXCLUDED" })).total).toBe(1);
    await setImportedStatus(actor, id, "UNMATCHED");
    expect((await listImportedTransactions(reader, { connectionId: c.id, status: "UNMATCHED" })).total).toBe(1);
    // nobody else's, nothing unknown, and nothing that did not come from a connection
    expect(await refusal(setImportedStatus(otherOwner, id, "EXCLUDED"))).toBe("integrations.transactionNotFound");
    expect(await refusal(setImportedStatus(actor, randomUUID(), "EXCLUDED"))).toBe("integrations.transactionNotFound");
    const plain = randomUUID();
    await db.query("INSERT INTO bank_transaction (id, company_id, account_id, txn_date, amount_cents, description, dedupe_key, updated_at) VALUES ($1, $2, $3, '2026-06-01', 100, 'Relevé', 'plain-1', now())", [plain, W.companyA, c.account]);
    expect(await refusal(setImportedStatus(actor, plain, "EXCLUDED"))).toBe("integrations.transactionNotFound");
    expect((await listImportedTransactions(reader, { connectionId: c.id })).transactions.map((t) => t.id)).not.toContain(plain);
  });
});
