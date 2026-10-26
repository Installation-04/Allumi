import { z } from "zod";
import { accountingDate, cleanText, decimalToCents, supportsCents, type Mapped, type TransactionKind } from "./transaction";

const money = z.object({ currency_code: z.string().regex(/^[A-Z]{3}$/), value: z.string().max(32) });

/**
 * A record of PayPal's Transaction Search (`GET /v1/reporting/transactions`, `transaction_info` only: no payer or
 * shipping details are requested, so no customer name or e-mail is ever imported). Money is a decimal string.
 */
const infoSchema = z.object({
  transaction_id: z.string().min(1).max(24),
  transaction_event_code: z.string().regex(/^[A-Z][0-9]{4}$/),
  transaction_initiation_date: z.string(),
  transaction_amount: money,
  fee_amount: money.nullish(),
  transaction_status: z.string().max(1).nullish(),
  transaction_subject: z.string().nullish(),
  transaction_note: z.string().nullish(),
  invoice_id: z.string().nullish(),
  custom_field: z.string().nullish(),
});

export const paypalPageSchema = z.object({
  transaction_details: z.array(z.object({ transaction_info: z.unknown() }).passthrough()).nullish(),
  total_pages: z.number().int().min(0).nullish(),
  page: z.number().int().min(0).nullish(),
});

/** "2026-06-01T04:03:52+0000", "…+00:00" or "…Z" (PayPal writes the offset without a colon) as an instant. */
export function parsePayPalDate(text: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})$/.exec(text);
  if (!match) return null;
  const [, y, mo, d, h, mi, s, zone] = match;
  const offset = zone === "Z" ? 0 : (zone?.startsWith("-") ? -1 : 1) * (Number(zone?.slice(1, 3)) * 60 + Number(zone?.slice(-2)));
  const instant = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)) - offset * 60_000;
  return Number.isFinite(instant) ? new Date(instant) : null;
}

/** `T0006` → what kind of movement it is. Only the families that are clear; anything else stays OTHER (the code is kept). */
function kindOf(code: string): TransactionKind {
  const family = code.slice(0, 3);
  if (family === "T00") return "PAYMENT";
  if (family === "T01") return "FEE";
  if (family === "T11") return "REFUND";
  if (family === "T12" || family === "T15") return "DISPUTE";
  if (family === "T04") return "PAYOUT";
  return "OTHER";
}

/**
 * One transaction, or why it is left out.
 *
 * Fee sign: PayPal's reference does not say which sign `fee_amount` has. Allumi takes it as a signed effect on the
 * balance, like `transaction_amount` (a fee charged on a payment received is negative), so the net is amount + fee and
 * the fee kept in cents is its opposite. The raw strings are stored with each transaction so a different convention can
 * be corrected afterwards, and a fee whose sign is not the one expected is flagged `unusualFeeSign` for review.
 */
export function mapPayPalTransaction(input: unknown): Mapped {
  const parsed = infoSchema.safeParse(input);
  if (!parsed.success) throw new TypeError("paypal transaction: unexpected shape");
  const t = parsed.data;
  const currency = t.transaction_amount.currency_code;
  if (t.fee_amount && t.fee_amount.currency_code !== currency) throw new TypeError("paypal transaction: fee currency differs");
  const status = t.transaction_status ?? "S";
  if (status !== "S" && status !== "V") return { ok: false, reason: "notSettled" };
  if (!supportsCents(currency)) return { ok: false, reason: "unsupportedCurrency" };
  const gross = decimalToCents(t.transaction_amount.value);
  const feeSigned = t.fee_amount ? decimalToCents(t.fee_amount.value) : 0n;
  const initiated = parsePayPalDate(t.transaction_initiation_date);
  if (gross === null || feeSigned === null || !initiated) throw new TypeError("paypal transaction: unreadable amount or date");
  const code = t.transaction_event_code;
  const unusualFeeSign = (gross > 0n && feeSigned > 0n) || (gross < 0n && feeSigned < 0n);
  const reference = cleanText(t.invoice_id, 127) || cleanText(t.custom_field, 127) || null;
  return {
    ok: true,
    transaction: {
      externalId: `paypal:${t.transaction_id}:${code}`,
      date: accountingDate(initiated),
      amountCents: gross + feeSigned,
      grossCents: gross,
      feeCents: -feeSigned,
      currency,
      sourceType: code,
      description: cleanText(t.transaction_subject, 200) || cleanText(t.transaction_note, 200) || `PayPal ${code}`,
      details: {
        kind: kindOf(code), status, reference, rawAmount: t.transaction_amount.value, rawFee: t.fee_amount?.value ?? null, initiated: t.transaction_initiation_date, unusualFeeSign,
      },
    },
  };
}
