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
