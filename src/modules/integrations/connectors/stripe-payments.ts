import { AppError } from "@/platform/errors";
import type { StripeCredentials } from "../domain/credentials";
import { mapPaidSession, type MappedSession } from "../domain/online-payment";
import { stripeListSchema } from "../domain/stripe";
import { requestJson } from "./shared";
import type { ConnectorContext, PaymentConnector } from "./types";

const ORIGIN = "https://api.stripe.com";
/** A page takes one payment: more than a few completed sessions on it means something is wrong, not that there is more to read. */
const SESSIONS_PER_PAGE = 20;

/**
 * Stripe Payment Links. The key needs: Prices (write), Payment Links (write), Checkout Sessions (read), PaymentIntents
 * (read) and, for the transaction import, Balance transactions (read). Nothing else of the account is touched.
 */
export function stripePayments(credentials: StripeCredentials, { http }: ConnectorContext): PaymentConnector {
  const auth = { Authorization: `Bearer ${credentials.apiKey}`, Accept: "application/json" };
  const get = (path: string, params: Record<string, string | string[]>) => {
    const query = new URLSearchParams();
    for (const [name, value] of Object.entries(params)) for (const one of Array.isArray(value) ? value : [value]) query.append(name, one);
    return requestJson(http, `${ORIGIN}${path}?${query}`, { headers: auth });
  };
  const post = (path: string, params: Record<string, string>, idempotencyKey?: string) =>
    requestJson(http, `${ORIGIN}${path}`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/x-www-form-urlencoded", ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) },
      body: new URLSearchParams(params).toString(),
    });
  const field = (body: unknown, name: string, pattern: RegExp): string => {
    const value = typeof body === "object" && body !== null ? (body as Record<string, unknown>)[name] : undefined;
    if (typeof value !== "string" || !pattern.test(value)) throw new AppError("integrations.invalidResponse");
    return value;
  };

  return {
    async createPrice({ linkId, amountCents, currency, name }) {
      const body = await post(
        "/v1/prices",
        { currency: currency.toLowerCase(), unit_amount: amountCents.toString(), "product_data[name]": name, "metadata[allumi_link]": linkId },
        `allumi-price-${linkId}`,
      );
      return field(body, "id", /^price_[A-Za-z0-9_]{4,200}$/);
    },

    async createLink({ linkId, priceId, description }) {
      const body = await post(
        "/v1/payment_links",
        {
          "line_items[0][price]": priceId,
          "line_items[0][quantity]": "1",
          // One completed payment, then the page closes by itself: an invoice is not paid twice.
          "restrictions[completed_sessions][limit]": "1",
          "metadata[allumi_link]": linkId,
          "payment_intent_data[description]": description,
          "payment_intent_data[metadata][allumi_link]": linkId,
        },
        `allumi-link-${linkId}`,
      );
      return { id: field(body, "id", /^plink_[A-Za-z0-9_]{4,200}$/), url: field(body, "url", /^https:\/\/[^\s]{1,480}$/) };
    },

    async deactivateLink(externalId) {
      await post(`/v1/payment_links/${encodeURIComponent(externalId)}`, { active: "false" });
    },

    async listPayments(externalId) {
      const list = stripeListSchema.safeParse(await get("/v1/checkout/sessions", { payment_link: externalId, status: "complete", limit: String(SESSIONS_PER_PAGE) }));
      if (!list.success) throw new AppError("integrations.invalidResponse");
      const payments: MappedSession[] = [];
      let waiting = 0;
      for (const session of list.data.data) {
        try {
          const record = session as { payment_status?: unknown; payment_intent?: unknown };
          // Not paid yet (a bank debit still clearing): nothing to read from the intent.
          if (record.payment_status !== "paid" || typeof record.payment_intent !== "string") {
            waiting++;
            continue;
          }
          const intent = await get(`/v1/payment_intents/${encodeURIComponent(record.payment_intent)}`, { "expand[]": "latest_charge.balance_transaction" });
          const mapped = mapPaidSession(session, intent);
          if (mapped.ok || mapped.reason !== "waiting") payments.push(mapped);
          else waiting++;
        } catch (error) {
          if (error instanceof AppError) throw error;
          throw new AppError("integrations.invalidResponse");
        }
      }
      return { payments, waiting };
    },
  };
}
