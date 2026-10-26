import { z } from "zod";
import { accountingDate, cleanText, supportsCents, type Mapped, type TransactionKind } from "./transaction";

/**
 * A Stripe balance transaction, as listed by `GET /v1/balance_transactions` (documented fields only). Amounts are
 * integers in the smallest currency unit; `amount` is the gross, `fee` is positive when charged and `net = amount − fee`.
 */
const balanceTransactionSchema = z.object({
  id: z.string().regex(/^txn_[A-Za-z0-9_]{4,80}$/),
  amount: z.number().int().safe(),
  fee: z.number().int().safe(),
  net: z.number().int().safe(),
  currency: z.string().regex(/^[a-z]{3}$/),
  created: z.number().int().positive(),
  type: z.string().min(1).max(80),
  reporting_category: z.string().max(80).nullish(),
  description: z.string().nullish(),
  source: z.string().max(80).nullish(),
  status: z.string().max(20).nullish(),
});

export const stripeListSchema = z.object({
  data: z.array(z.unknown()),
  has_more: z.boolean(),
});

function kindOf(category: string | null | undefined, type: string): TransactionKind {
  switch (category ?? "") {
    case "charge": return "PAYMENT";
    case "refund": return "REFUND";
    case "payout":
    case "payout_reversal": return "PAYOUT";
    case "fee": return "FEE";
    case "dispute":
    case "dispute_reversal": return "DISPUTE";
    case "other_adjustment":
    case "adjustment": return "ADJUSTMENT";
  }
  if (type === "charge" || type === "payment") return "PAYMENT";
  if (type === "refund" || type === "payment_refund") return "REFUND";
  if (type === "payout" || type === "payout_cancel" || type === "payout_failure") return "PAYOUT";
  if (["stripe_fee", "stripe_fx_fee", "tax_fee", "application_fee"].includes(type)) return "FEE";
  if (type === "adjustment") return "ADJUSTMENT";
  return "OTHER";
}

/**
 * One balance transaction, or why it is left out. Anything that does not have the documented shape, or whose figures
 * do not add up (`net ≠ amount − fee`), is an error: the sync stops rather than put a wrong amount in the books.
 */
export function mapStripeBalanceTransaction(input: unknown): Mapped {
  const parsed = balanceTransactionSchema.safeParse(input);
  if (!parsed.success) throw new TypeError("stripe balance transaction: unexpected shape");
  const t = parsed.data;
  if (t.net !== t.amount - t.fee) throw new TypeError("stripe balance transaction: net is not amount minus fee");
  const currency = t.currency.toUpperCase();
  if (!supportsCents(currency)) return { ok: false, reason: "unsupportedCurrency" };
  const kind = kindOf(t.reporting_category, t.type);
  return {
    ok: true,
    transaction: {
      externalId: `stripe:${t.id}`,
      date: accountingDate(new Date(t.created * 1000)),
      amountCents: BigInt(t.net),
      grossCents: BigInt(t.amount),
      feeCents: BigInt(t.fee),
      currency,
      sourceType: t.type,
      description: cleanText(t.description, 200) || `Stripe ${t.type}`,
      details: { kind, status: t.status ?? null, reportingCategory: t.reporting_category ?? null, source: t.source ?? null, created: t.created, rawAmount: t.amount, rawFee: t.fee, rawNet: t.net },
    },
  };
}
