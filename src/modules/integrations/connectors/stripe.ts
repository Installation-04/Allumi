import { AppError } from "@/platform/errors";
import type { StripeCredentials } from "../domain/credentials";
import { mapStripeBalanceTransaction, stripeListSchema } from "../domain/stripe";
import { emptySkips, type Connector, type ConnectorContext, type FetchedWindow } from "./types";
import { requestJson } from "./shared";

const ORIGIN = "https://api.stripe.com";
const PAGE_SIZE = 100;
/** 100 pages of 100: a window that holds more is split by the caller. */
const MAX_PAGES = 100;

export function stripeConnector(credentials: StripeCredentials, { http }: ConnectorContext): Connector {
  const get = (path: string, params: Record<string, string>) =>
    requestJson(http, `${ORIGIN}${path}?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${credentials.apiKey}`, Accept: "application/json" } });

  return {
    async verify() {
      await get("/v1/balance_transactions", { limit: "1" });
    },

    async fetchWindow({ from, to }): Promise<FetchedWindow> {
      const result: FetchedWindow = { transactions: [], skipped: emptySkips() };
      let startingAfter: string | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        const params: Record<string, string> = { limit: String(PAGE_SIZE), "created[gte]": String(Math.floor(from.getTime() / 1000)), "created[lt]": String(Math.floor(to.getTime() / 1000)) };
        if (startingAfter) params.starting_after = startingAfter;
        const body = stripeListSchema.safeParse(await get("/v1/balance_transactions", params));
        if (!body.success) throw new AppError("integrations.invalidResponse");
        for (const item of body.data.data) {
          try {
            const mapped = mapStripeBalanceTransaction(item);
            if (mapped.ok) result.transactions.push(mapped.transaction);
            else result.skipped[mapped.reason]++;
          } catch {
            throw new AppError("integrations.invalidResponse");
          }
        }
        if (!body.data.has_more) return result;
        const last = body.data.data.at(-1);
        startingAfter = typeof last === "object" && last !== null && "id" in last && typeof last.id === "string" ? last.id : undefined;
        if (!startingAfter) throw new AppError("integrations.invalidResponse");
      }
      throw new AppError("integrations.tooMany");
    },
  };
}
