import type { HttpClient, HttpRequest } from "@/modules/integrations";

/**
 * In-memory stand-ins for Stripe and PayPal that behave as their documentation says (authentication, the `created`
 * filter and cursor pagination of Stripe, the 31-day window and page numbers of PayPal's Transaction Search), so the
 * connectors are tested end to end without a network, a key or an account. They are only as true as the
 * documentation: what a live account does is still to be confirmed with test keys.
 */
export type Call = { url: string; method: string; headers: Record<string, string>; body: string | undefined };
export type Reply = { status: number; body?: unknown; raw?: string };
export type Handler = (url: URL, init: HttpRequest, call: Call) => Reply | Promise<Reply>;

export function fakeHttp(handler: Handler): { http: HttpClient; calls: Call[] } {
  const calls: Call[] = [];
  const http: HttpClient = async (url, init) => {
    const call: Call = { url, method: init.method ?? "GET", headers: init.headers ?? {}, body: init.body };
    calls.push(call);
    const reply = await handler(new URL(url), init, call);
    return { status: reply.status, text: async () => reply.raw ?? JSON.stringify(reply.body ?? {}) };
  };
  return { http, calls };
}

// ---------------------------------------------------------------- Stripe

export type StripeTxn = {
  id: string; amount: number; fee: number; net: number; currency: string; created: number; type: string;
  reporting_category: string | null; description: string | null; source: string | null; status: string;
};

export function stripeTxn(over: Partial<StripeTxn> & { id: string; created: number }): StripeTxn {
  const amount = over.amount ?? 10000;
  const fee = over.fee ?? 320;
  return { amount, fee, net: amount - fee, currency: "cad", type: "charge", reporting_category: "charge", description: "Facture", source: "ch_1", status: "available", ...over };
}

export const STRIPE_ORIGIN = "https://api.stripe.com";

/** `GET /v1/balance_transactions`: newest first, `created[gte|lt]`, `limit` (≤ 100) and `starting_after`, as documented. */
export function stripeHandler(options: { key: string; transactions: () => StripeTxn[]; onList?: (url: URL) => Reply | undefined }): Handler {
  return (url, init) => {
    if (url.origin !== STRIPE_ORIGIN) throw new Error(`a Stripe request went to ${url.origin}`);
    if (init.headers?.Authorization !== `Bearer ${options.key}`) return { status: 401, body: { error: { type: "invalid_request_error", message: `Invalid API Key provided: ${options.key.slice(0, 12)}***` } } };
    if (url.pathname !== "/v1/balance_transactions") return { status: 404, body: {} };
    const intercepted = options.onList?.(url);
    if (intercepted) return intercepted;
    const gte = Number(url.searchParams.get("created[gte]") ?? 0);
    const lt = Number(url.searchParams.get("created[lt]") ?? Number.MAX_SAFE_INTEGER);
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 10), 100);
    let list = options.transactions().filter((t) => t.created >= gte && t.created < lt).sort((a, b) => b.created - a.created || (a.id < b.id ? 1 : -1));
    const after = url.searchParams.get("starting_after");
    if (after) list = list.slice(list.findIndex((t) => t.id === after) + 1);
    return { status: 200, body: { object: "list", url: "/v1/balance_transactions", has_more: list.length > limit, data: list.slice(0, limit) } };
  };
}

// ---------------------------------------------------------------- PayPal

export type PayPalTxn = { id: string; code: string; initiated: string; amount: string; fee?: string; currency?: string; status?: string; subject?: string; invoice?: string };

export const PAYPAL_ORIGIN = { live: "https://api-m.paypal.com", sandbox: "https://api-m.sandbox.paypal.com" } as const;
export const PAYPAL_TOKEN = "A21AAL-fake-access-token-0123456789";

const instant = (text: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\+0000$/.exec(text);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])) : null;
};

/** The OAuth client-credentials token and `GET /v1/reporting/transactions` (31 days at most, 500 per page, 1-based pages). */
export function paypalHandler(options: { origin: string; clientId: string; clientSecret: string; transactions: () => PayPalTxn[]; onReport?: (url: URL) => Reply | undefined }): Handler {
  return (url, init) => {
    if (url.origin !== options.origin) throw new Error(`a PayPal request went to ${url.origin}`);
    if (url.pathname === "/v1/oauth2/token") {
      const expected = `Basic ${Buffer.from(`${options.clientId}:${options.clientSecret}`).toString("base64")}`;
      if (init.method !== "POST" || init.headers?.Authorization !== expected || init.body !== "grant_type=client_credentials") return { status: 401, body: { error: "invalid_client", error_description: `Client Authentication failed for ${options.clientId}` } };
      return { status: 200, body: { access_token: PAYPAL_TOKEN, token_type: "Bearer", expires_in: 32400 } };
    }
    if (url.pathname !== "/v1/reporting/transactions") return { status: 404, body: {} };
    if (init.headers?.Authorization !== `Bearer ${PAYPAL_TOKEN}`) return { status: 401, body: { name: "AUTHENTICATION_FAILURE" } };
    const intercepted = options.onReport?.(url);
    if (intercepted) return intercepted;
    const start = instant(url.searchParams.get("start_date") ?? "");
    const end = instant(url.searchParams.get("end_date") ?? "");
    if (start === null || end === null || end < start || end - start > 31 * 86_400_000) return { status: 400, body: { name: "INVALID_REQUEST", message: "date range" } };
    if (url.searchParams.get("fields") !== "transaction_info") return { status: 400, body: { name: "UNEXPECTED_FIELDS" } }; // never ask for payer details
    const size = Math.min(Number(url.searchParams.get("page_size") ?? 100), 500);
    const page = Number(url.searchParams.get("page") ?? 1);
    const all = options.transactions().filter((t) => {
      const at = instant(t.initiated) ?? 0;
      return at >= start && at <= end;
    });
    const slice = all.slice((page - 1) * size, page * size);
    return {
      status: 200,
      body: {
        transaction_details: slice.map((t) => ({
          transaction_info: {
            transaction_id: t.id, transaction_event_code: t.code, transaction_initiation_date: t.initiated, transaction_updated_date: t.initiated,
            transaction_amount: { currency_code: t.currency ?? "CAD", value: t.amount },
            ...(t.fee === undefined ? {} : { fee_amount: { currency_code: t.currency ?? "CAD", value: t.fee } }),
            transaction_status: t.status ?? "S", ...(t.subject ? { transaction_subject: t.subject } : {}), ...(t.invoice ? { invoice_id: t.invoice } : {}),
          },
        })),
        account_number: "ABCDEFGHIJKLM", page, total_items: all.length, total_pages: Math.max(1, Math.ceil(all.length / size)),
      },
    };
  };
}

// ---------------------------------------------------------------- Stripe payment pages

let shopSequence = 0;
type ShopLink = { id: string; url: string; price: string; active: boolean; limit: number; metadata: Record<string, string>; description: string };
type ShopSession = { id: string; link: string; status: string; payment_status: string; amount_total: number; currency: string; payment_intent: string | null; created: number };
type ShopIntent = {
  id: string; status: string; amount: number; amount_received: number; currency: string;
  charge: { id: string; paid: boolean; bt: { id: string; amount: number; fee: number; net: number; currency: string; created: number } | null };
};
export type ShopPay = { amount?: number; fee?: number; at?: string; paymentStatus?: "paid" | "unpaid"; settlement?: string; force?: boolean; settled?: boolean };

/**
 * Stripe's price, payment link, Checkout Session and PaymentIntent endpoints as the documentation describes them
 * (form-encoded bodies, the Idempotency-Key header, `expand[]` on the intent, a link that closes after its limit of
 * completed sessions), with a customer who can pay through a page: `pay`. State lives in the maps so a test can look
 * at what the connector asked for.
 */
export function stripeShop(options: { key: string; transactions?: () => StripeTxn[]; onRequest?: (url: URL, init: HttpRequest) => Reply | undefined }) {
  const prices = new Map<string, { id: string; unit_amount: number; currency: string; name: string }>();
  const links = new Map<string, ShopLink>();
  const sessions: ShopSession[] = [];
  const intents = new Map<string, ShopIntent>();
  const replays = new Map<string, { fingerprint: string; reply: Reply }>();
  // Ids are unique across shops, as Stripe's are: two tests of one company must not meet the same session.
  const next = (prefix: string) => `${prefix}_${String(++shopSequence).padStart(4, "0")}TestId${shopSequence}`;
  const form = (body: string | undefined) => Object.fromEntries(new URLSearchParams(body ?? ""));
  const base = options.transactions ? stripeHandler({ key: options.key, transactions: options.transactions }) : undefined;
  const bad = (message: string): Reply => ({ status: 400, body: { error: { type: "invalid_request_error", message } } });

  const handler: Handler = (url, init, call) => {
    if (url.origin !== STRIPE_ORIGIN) throw new Error(`a Stripe request went to ${url.origin}`);
    if (init.headers?.Authorization !== `Bearer ${options.key}`) return { status: 401, body: { error: { type: "invalid_request_error", message: `Invalid API Key provided: ${options.key.slice(0, 12)}***` } } };
    const intercepted = options.onRequest?.(url, init);
    if (intercepted) return intercepted;
    const path = url.pathname;
    if (path === "/v1/balance_transactions") return base ? base(url, init, call) : { status: 404, body: {} };

    if (init.method === "POST") {
      const key = init.headers?.["Idempotency-Key"];
      const fingerprint = `${path}?${init.body ?? ""}`;
      if (key) {
        const seen = replays.get(key);
        if (seen) return seen.fingerprint === fingerprint ? seen.reply : bad("Keys for idempotent requests can only be used with the same parameters they were first used with.");
      }
      if (init.headers?.["Content-Type"] !== "application/x-www-form-urlencoded") return bad("expected a form-encoded body");
      const p = form(init.body);
      let reply: Reply;
      if (path === "/v1/prices") {
        const amount = Number(p.unit_amount);
        if (!/^[a-z]{3}$/.test(p.currency ?? "") || !Number.isInteger(amount) || amount < 50 || !p["product_data[name]"]) return bad("invalid price");
        const price = { id: next("price"), unit_amount: amount, currency: p.currency!, name: p["product_data[name]"]! };
        prices.set(price.id, price);
        reply = { status: 200, body: { object: "price", ...price, product: "prod_x" } };
      } else if (path === "/v1/payment_links") {
        const price = prices.get(p["line_items[0][price]"] ?? "");
        if (!price || p["line_items[0][quantity]"] !== "1") return bad("invalid line item");
        const link: ShopLink = {
          id: next("plink"), url: `https://buy.stripe.com/test_${shopSequence}`, price: price.id, active: true, limit: Number(p["restrictions[completed_sessions][limit]"] ?? 0),
          metadata: { allumi_link: p["metadata[allumi_link]"] ?? "" }, description: p["payment_intent_data[description]"] ?? "",
        };
        links.set(link.id, link);
        reply = { status: 200, body: { object: "payment_link", id: link.id, active: true, url: link.url, metadata: link.metadata, currency: price.currency } };
      } else if (path.startsWith("/v1/payment_links/")) {
        const link = links.get(decodeURIComponent(path.slice("/v1/payment_links/".length)));
        if (!link) return { status: 404, body: { error: { type: "invalid_request_error", message: "No such payment link" } } };
        if (p.active !== undefined) link.active = p.active === "true";
        reply = { status: 200, body: { object: "payment_link", id: link.id, active: link.active, url: link.url } };
      } else return { status: 404, body: {} };
      if (key) replays.set(key, { fingerprint, reply });
      return reply;
    }

    if (path === "/v1/checkout/sessions") {
      const link = url.searchParams.get("payment_link");
      if (!link || !links.has(link)) return bad("payment_link");
      const status = url.searchParams.get("status");
      const limit = Math.min(Number(url.searchParams.get("limit") ?? 10), 100);
      const mine = sessions.filter((s) => s.link === link && (!status || s.status === status)).sort((a, b) => b.created - a.created);
      return { status: 200, body: { object: "list", url: "/v1/checkout/sessions", has_more: mine.length > limit, data: mine.slice(0, limit).map(({ link: l, ...s }) => ({ object: "checkout.session", payment_link: l, ...s })) } };
    }
    if (path.startsWith("/v1/payment_intents/")) {
      const intent = intents.get(decodeURIComponent(path.slice("/v1/payment_intents/".length)));
      if (!intent) return { status: 404, body: { error: { type: "invalid_request_error", message: "No such payment_intent" } } };
      const expanded = url.searchParams.getAll("expand[]").includes("latest_charge.balance_transaction");
      const bt = intent.charge.bt;
      return {
        status: 200,
        body: {
          object: "payment_intent", id: intent.id, status: intent.status, amount: intent.amount, amount_received: intent.amount_received, currency: intent.currency,
          latest_charge: expanded
            ? { object: "charge", id: intent.charge.id, paid: intent.charge.paid, refunded: false, balance_transaction: bt && { object: "balance_transaction", ...bt } }
            : intent.charge.id,
        },
      };
    }
    return { status: 404, body: {} };
  };

  /** A customer pays through the page of a link (by default the whole price, with Stripe's usual card fee, already settled). */
  function pay(linkId: string, over: ShopPay = {}): ShopSession {
    const link = links.get(linkId);
    if (!link) throw new Error(`no such link ${linkId}`);
    if (!link.active && !over.force) throw new Error("the page is closed: nobody can pay on it");
    const price = prices.get(link.price)!;
    const amount = over.amount ?? price.unit_amount;
    const fee = over.fee ?? Math.round(amount * 0.029) + 30;
    const created = Math.floor(Date.parse(over.at ?? "2026-06-15T15:00:00Z") / 1000);
    const paid = (over.paymentStatus ?? "paid") === "paid";
    const intent: ShopIntent = {
      id: next("pi"), status: paid ? "succeeded" : "processing", amount, amount_received: paid ? amount : 0, currency: price.currency,
      charge: { id: next("ch"), paid, bt: paid && over.settled !== false ? { id: next("txn"), amount, fee, net: amount - fee, currency: over.settlement ?? price.currency, created } : null },
    };
    intents.set(intent.id, intent);
    const session: ShopSession = {
      id: next("cs_test"), link: linkId, status: "complete", payment_status: paid ? "paid" : "unpaid", amount_total: amount, currency: price.currency, payment_intent: intent.id, created,
    };
    sessions.push(session);
    if (paid && link.limit > 0 && sessions.filter((s) => s.link === linkId && s.payment_status === "paid").length >= link.limit) link.active = false;
    return session;
  }
  /** The payment that was clearing has settled. */
  const settle = (sessionId: string) => {
    const session = sessions.find((s) => s.id === sessionId)!;
    const intent = intents.get(session.payment_intent!)!;
    const fee = Math.round(intent.amount * 0.029) + 30;
    session.payment_status = "paid";
    intent.status = "succeeded";
    intent.amount_received = intent.amount;
    intent.charge.paid = true;
    intent.charge.bt = { id: next("txn"), amount: intent.amount, fee, net: intent.amount - fee, currency: intent.currency, created: session.created };
  };
  return { handler, prices, links, sessions, intents, pay, settle };
}
