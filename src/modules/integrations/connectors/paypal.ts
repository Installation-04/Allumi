import { z } from "zod";
import { AppError } from "@/platform/errors";
import type { PayPalCredentials } from "../domain/credentials";
import { mapPayPalTransaction, paypalPageSchema } from "../domain/paypal";
import { emptySkips, type Connector, type ConnectorContext, type FetchedWindow } from "./types";
import { requestJson } from "./shared";

const ORIGINS = { live: "https://api-m.paypal.com", sandbox: "https://api-m.sandbox.paypal.com" } as const;
const PAGE_SIZE = 500;
/** 100 pages of 500: a window that holds more is split by the caller. */
const MAX_PAGES = 100;

const tokenSchema = z.object({ access_token: z.string().min(10).max(4096) });

/** PayPal's own date format for a request: `2026-06-01T04:03:52+0000`. */
const stamp = (date: Date) => `${date.toISOString().slice(0, 19)}+0000`;

export function paypalConnector(credentials: PayPalCredentials, { sandbox, http }: ConnectorContext): Connector {
  const origin = sandbox ? ORIGINS.sandbox : ORIGINS.live;
  let token: string | undefined;

  async function accessToken(): Promise<string> {
    if (token) return token;
    const basic = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`, "utf8").toString("base64");
    const body = tokenSchema.safeParse(await requestJson(http, `${origin}/v1/oauth2/token`, {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: "grant_type=client_credentials",
    }));
    if (!body.success) throw new AppError("integrations.invalidResponse");
    token = body.data.access_token;
    return token;
  }

  const page = async (params: Record<string, string>) =>
    requestJson(http, `${origin}/v1/reporting/transactions?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${await accessToken()}`, Accept: "application/json" } });

  return {
    async verify() {
      // A one-day window is enough to prove the token works and that Transaction Search is allowed for this app.
      const end = new Date();
      await page({ start_date: stamp(new Date(end.getTime() - 86_400_000)), end_date: stamp(end), fields: "transaction_info", page_size: "1", page: "1" });
    },

    async fetchWindow({ from, to }): Promise<FetchedWindow> {
      const result: FetchedWindow = { transactions: [], skipped: emptySkips() };
      for (let number = 1; number <= MAX_PAGES; number++) {
        const body = paypalPageSchema.safeParse(await page({
          start_date: stamp(from), end_date: stamp(to), fields: "transaction_info", balance_affecting_records_only: "Y", page_size: String(PAGE_SIZE), page: String(number),
        }));
        if (!body.success) throw new AppError("integrations.invalidResponse");
        for (const detail of body.data.transaction_details ?? []) {
          try {
            const mapped = mapPayPalTransaction(detail.transaction_info);
            if (mapped.ok) result.transactions.push(mapped.transaction);
            else result.skipped[mapped.reason]++;
          } catch {
            throw new AppError("integrations.invalidResponse");
          }
        }
        if (number >= (body.data.total_pages ?? 1)) return result;
      }
      throw new AppError("integrations.tooMany");
    },
  };
}
