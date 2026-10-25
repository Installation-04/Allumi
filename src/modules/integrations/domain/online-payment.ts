import { z } from "zod";
import { accountingDate, cleanText } from "./transaction";

/** Same list as the database enum `payment_link_status`. */
export const PAYMENT_LINK_STATUSES = ["PENDING", "ACTIVE", "PAID", "REVIEW", "CANCELLED"] as const;
export type PaymentLinkStatus = (typeof PAYMENT_LINK_STATUSES)[number];

/** Stripe takes at least 0.50 and at most 999,999.99 in a single payment (Canadian dollars). */
export const MIN_LINK_CENTS = 50n;
export const MAX_LINK_CENTS = 99_999_999n;
/** Only Canadian dollars for now: the books are kept in one currency. */
export const LINK_CURRENCY = "CAD";

/** Why a balance cannot become a payment link, or null when it can. The keys are messages under `errors`. */
export function linkAmountProblem(amountCents: bigint, currency: string): "onlinePayments.currency" | "onlinePayments.amountRange" | null {
  if (currency !== LINK_CURRENCY) return "onlinePayments.currency";
  if (amountCents < MIN_LINK_CENTS || amountCents > MAX_LINK_CENTS) return "onlinePayments.amountRange";
  return null;
}

/** What the customer reads on the payment page and on Stripe's receipt: the invoice, in the language it was issued in. */
export function linkDescription(number: string | null, locale: string): string {
  const label = locale === "en" ? "Invoice" : "Facture";
  const text = cleanText(number, 40);
  return text ? `${label} ${text}` : label;
}

/** The two lines of the entry that books processing fees: the expense goes up, the balance held at the service goes down. */
export function feeEntryLines(feeAccountId: string, connectionAccountId: string, feeCents: bigint) {
  return [
    { accountId: feeAccountId, debitCents: feeCents, creditCents: 0n },
    { accountId: connectionAccountId, debitCents: 0n, creditCents: feeCents },
  ];
}

// ---------------------------------------------------------------- what Stripe reports of a paid session

/** A Checkout Session, as listed by `GET /v1/checkout/sessions` (documented fields only). */
export const checkoutSessionSchema = z.object({
  id: z.string().regex(/^cs_[A-Za-z0-9_]{4,200}$/),
  status: z.string().max(20),
  payment_status: z.string().max(30),
  amount_total: z.number().int().safe().nullable(),
  currency: z.string().regex(/^[a-z]{3}$/).nullable(),
  payment_intent: z.string().regex(/^pi_[A-Za-z0-9_]{4,200}$/).nullable(),
  payment_link: z.string().max(100).nullable().optional(),
});
export type CheckoutSession = z.infer<typeof checkoutSessionSchema>;

/** A PaymentIntent retrieved with `expand[]=latest_charge.balance_transaction`. */
export const paymentIntentSchema = z.object({
  id: z.string().regex(/^pi_[A-Za-z0-9_]{4,200}$/),
  status: z.string().max(40),
  amount: z.number().int().safe(),
  amount_received: z.number().int().safe(),
  currency: z.string().regex(/^[a-z]{3}$/),
  latest_charge: z
    .object({
      id: z.string().max(100),
      paid: z.boolean(),
      refunded: z.boolean().optional(),
      balance_transaction: z
        .object({
          id: z.string().regex(/^txn_[A-Za-z0-9_]{4,80}$/),
          amount: z.number().int().safe(),
          fee: z.number().int().safe(),
          net: z.number().int().safe(),
          currency: z.string().regex(/^[a-z]{3}$/),
          created: z.number().int().positive(),
        })
        .nullable(),
    })
    .nullable(),
});
export type PaymentIntent = z.infer<typeof paymentIntentSchema>;

/** A payment that Stripe has taken and settled, in exact cents. */
export type PaidSession = {
  sessionId: string;
  paymentIntentId: string;
  /** What the customer paid. */
  grossCents: bigint;
  /** What Stripe kept (positive). */
  feeCents: bigint;
  /** What reaches the balance: gross − fee. */
  netCents: bigint;
  currency: string;
  /** The moment Stripe took the payment. */
  paidAt: Date;
};

export type MappedSession =
  /** Paid and settled. */
  | { ok: true; paid: PaidSession }
  /** Not paid yet (a bank debit still clearing) or not settled yet: look again later. */
  | { ok: false; reason: "waiting" }
  /** Paid, but the balance is held in another currency than the payment: the figures cannot be booked as they are. */
  | { ok: false; reason: "settlementCurrency"; sessionId: string };

/**
 * One completed Checkout Session and its PaymentIntent, turned into a payment. Anything that does not have the
 * documented shape, or whose figures do not agree with each other (the session, the intent and the balance
 * transaction must all say the same gross; net must be gross − fee), is an error: the collection stops rather than
 * put a wrong amount in the books.
 */
export function mapPaidSession(sessionInput: unknown, intentInput: unknown): MappedSession {
  const session = checkoutSessionSchema.safeParse(sessionInput);
  if (!session.success) throw new TypeError("stripe checkout session: unexpected shape");
  const s = session.data;
  if (s.status !== "complete" || s.payment_status !== "paid") return { ok: false, reason: "waiting" };
  const intent = paymentIntentSchema.safeParse(intentInput);
  if (!intent.success) throw new TypeError("stripe payment intent: unexpected shape");
  const pi = intent.data;
  if (s.payment_intent !== pi.id || s.amount_total === null || s.currency === null) throw new TypeError("stripe payment intent: does not belong to the session");
  if (pi.status !== "succeeded" || !pi.latest_charge?.paid || !pi.latest_charge.balance_transaction) return { ok: false, reason: "waiting" };
  const bt = pi.latest_charge.balance_transaction;
  if (bt.net !== bt.amount - bt.fee) throw new TypeError("stripe balance transaction: net is not amount minus fee");
  if (s.amount_total !== pi.amount_received || pi.currency !== s.currency) throw new TypeError("stripe payment intent: figures differ from the session");
  if (bt.currency !== s.currency) return { ok: false, reason: "settlementCurrency", sessionId: s.id };
  if (bt.amount !== s.amount_total) throw new TypeError("stripe balance transaction: amount differs from the session");
  return {
    ok: true,
    paid: {
      sessionId: s.id, paymentIntentId: pi.id, grossCents: BigInt(bt.amount), feeCents: BigInt(bt.fee), netCents: BigInt(bt.net),
      currency: bt.currency.toUpperCase(), paidAt: new Date(bt.created * 1000),
    },
  };
}

/**
 * Why a payment cannot be booked on its link, or null when it can. The database refuses the same cases
 * (`online_payment_guard`, `online_payment_amounts`): this is the clear message before it.
 */
export function paymentProblem(link: { amountCents: bigint; currency: string }, paid: Pick<PaidSession, "grossCents" | "feeCents" | "currency">): string | null {
  if (paid.currency !== link.currency) return "onlinePayments.currency";
  if (paid.grossCents !== link.amountCents) return "onlinePayments.amount";
  if (paid.feeCents < 0n || paid.feeCents > paid.grossCents) return "onlinePayments.fee";
  return null;
}

/** The day a payment is booked on: the day Stripe took it, in the company's time zone. */
export const bookingDate = (paidAt: Date): string => accountingDate(paidAt);

/** A reason kept on a link is a code. A database rule (AL006…) is one the person cannot read, so it becomes a general one. */
export function reviewCode(key: string): string {
  return /^[a-z][a-zA-Z0-9_.]{0,63}$/.test(key) ? key : "onlinePayments.rule";
}
