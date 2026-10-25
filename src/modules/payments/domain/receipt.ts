import { z } from "zod";

/** Same list as the database enum `payment_method`. */
export const PAYMENT_METHODS = ["CASH", "CHEQUE", "EFT", "INTERAC", "CREDIT_CARD", "DEBIT_CARD", "OTHER"] as const;
export type PaymentMethodKind = (typeof PAYMENT_METHODS)[number];

/** The ceiling of the CHECK on `payment.amount_cents` (1,000 billion dollars). */
const MAX_CENTS = 100_000_000_000_000n;

/** Cents typed as digits: the form sends strings, and a bigint never goes through a float. */
const cents = z.string().trim().regex(/^\d{1,15}$/).transform((value) => BigInt(value));
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** An empty or missing text is stored as NULL, never as an empty string. */
const optionalText = (max: number) => z.string().trim().max(max).optional().transform((value) => value || null);
const uuid = z.string().uuid();

/**
 * A payment received from a customer, applied in full to one posted invoice. `expectedOpenCents` is the balance the
 * person saw when the form was drawn: if the invoice has changed since (another payment, a credit note), the
 * service refuses instead of applying the amount to a balance nobody reviewed.
 */
export const receiptSchema = z.object({
  invoiceId: uuid,
  amountCents: cents.refine((value) => value > 0n && value <= MAX_CENTS),
  expectedOpenCents: cents,
  date: isoDate,
  accountId: uuid,
  method: z.enum(PAYMENT_METHODS),
  reference: optionalText(100),
  memo: optionalText(500),
});
export type ReceiptInput = z.input<typeof receiptSchema>;

/** The date and the reason of a void: the reason is kept for good on the payment and on its reversal. */
export const receiptVoidSchema = z.object({
  date: isoDate,
  reason: z.string().trim().min(1).max(500),
});

export type AccountForReceipt = { subtype: string; systemKey: string | null; isActive: boolean };

/**
 * Where a customer's money can land: a bank or cash account, or the "undeposited funds" account while it waits for
 * the bank deposit. The database accepts more (any current asset); the form offers only these.
 */
export function acceptsReceipts(account: AccountForReceipt): boolean {
  return account.isActive && (account.subtype === "BANK" || account.subtype === "CASH" || account.systemKey === "UNDEPOSITED_FUNDS");
}

export type SettlementStatus = "UNPAID" | "PARTIAL" | "PAID";

/** How much of an invoice is settled, from its total and its open balance (payments and applied credit notes both reduce it). */
export function settlementStatus(totalCents: bigint, openCents: bigint): SettlementStatus {
  if (openCents <= 0n) return "PAID";
  return openCents >= totalCents ? "UNPAID" : "PARTIAL";
}
