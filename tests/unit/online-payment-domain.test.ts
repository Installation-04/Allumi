import { describe, expect, it } from "vitest";
import {
  bookingDate, feeEntryLines, linkAmountProblem, linkDescription, mapPaidSession, MAX_LINK_CENTS, MIN_LINK_CENTS, paymentProblem, reviewCode,
} from "@/modules/integrations/domain/online-payment";

// Stripe fixtures: the documented fields of a completed Checkout Session and of its PaymentIntent with the charge expanded.
const session = { id: "cs_test_a1B2c3D4", object: "checkout.session", status: "complete", payment_status: "paid", amount_total: 11498, currency: "cad", payment_intent: "pi_3MtwBwLkdIwHu7ix28a3tqPa", payment_link: "plink_1MoC3ULkdIwHu7ixZjtGpVl2" };
const intent = (over: Record<string, unknown> = {}, bt: Record<string, unknown> | null = {}) => ({
  id: "pi_3MtwBwLkdIwHu7ix28a3tqPa", object: "payment_intent", status: "succeeded", amount: 11498, amount_received: 11498, currency: "cad",
  latest_charge: { id: "ch_3Mtw", paid: true, refunded: false, balance_transaction: bt && { id: "txn_1MiN3gLkdIwHu7ixxapQrznl", amount: 11498, fee: 363, net: 11135, currency: "cad", created: 1781535600, ...bt } },
  ...over,
});

describe("what a balance can become a payment link", () => {
  it("is between 0.50 and 999,999.99, in Canadian dollars", () => {
    expect(MIN_LINK_CENTS).toBe(50n);
    expect(MAX_LINK_CENTS).toBe(99_999_999n);
    expect(linkAmountProblem(49n, "CAD")).toBe("onlinePayments.amountRange");
    expect(linkAmountProblem(50n, "CAD")).toBeNull();
    expect(linkAmountProblem(99_999_999n, "CAD")).toBeNull();
    expect(linkAmountProblem(100_000_000n, "CAD")).toBe("onlinePayments.amountRange");
    expect(linkAmountProblem(0n, "CAD")).toBe("onlinePayments.amountRange");
    expect(linkAmountProblem(-5n, "CAD")).toBe("onlinePayments.amountRange");
    expect(linkAmountProblem(11498n, "USD")).toBe("onlinePayments.currency");
    expect(linkAmountProblem(11498n, "cad")).toBe("onlinePayments.currency"); // the books say CAD, upper case
  });
});

describe("what the customer reads", () => {
  it("names the invoice in the language it was issued in", () => {
    expect(linkDescription("F-00012", "fr_CA")).toBe("Facture F-00012");
    expect(linkDescription("F-00012", "en")).toBe("Invoice F-00012");
    expect(linkDescription(null, "fr_CA")).toBe("Facture");
    expect(linkDescription("  F-1\n\t2 ", "en")).toBe("Invoice F-1 2");
    expect(linkDescription("x".repeat(100), "en").length).toBeLessThanOrEqual(48);
  });
});

describe("the entry of the fees", () => {
  it("raises the expense and lowers the balance held at the service by the same amount", () => {
    const lines = feeEntryLines("expense", "stripe", 363n);
    expect(lines).toEqual([
      { accountId: "expense", debitCents: 363n, creditCents: 0n },
      { accountId: "stripe", debitCents: 0n, creditCents: 363n },
    ]);
    expect(lines.reduce((sum, line) => sum + line.debitCents - line.creditCents, 0n)).toBe(0n);
  });
});

describe("a payment as Stripe reports it", () => {
  it("is the gross the customer paid, the fee Stripe kept and the net it will pay out, in exact cents", () => {
    const mapped = mapPaidSession(session, intent());
    expect(mapped).toEqual({
      ok: true,
      paid: { sessionId: "cs_test_a1B2c3D4", paymentIntentId: "pi_3MtwBwLkdIwHu7ix28a3tqPa", grossCents: 11498n, feeCents: 363n, netCents: 11135n, currency: "CAD", paidAt: new Date(1781535600 * 1000) },
    });
  });

  it("waits for what is not paid and settled yet", () => {
    expect(mapPaidSession({ ...session, payment_status: "unpaid" }, intent({ status: "processing" }))).toEqual({ ok: false, reason: "waiting" });
    expect(mapPaidSession({ ...session, status: "open" }, intent())).toEqual({ ok: false, reason: "waiting" });
    expect(mapPaidSession(session, intent({ status: "processing" }))).toEqual({ ok: false, reason: "waiting" });
    expect(mapPaidSession(session, intent({}, null))).toEqual({ ok: false, reason: "waiting" }); // no balance transaction yet
    expect(mapPaidSession(session, intent({ latest_charge: null }))).toEqual({ ok: false, reason: "waiting" });
    expect(mapPaidSession(session, intent({ latest_charge: { id: "ch_3Mtw", paid: false, balance_transaction: null } }))).toEqual({ ok: false, reason: "waiting" });
  });

  it("is set apart when the service holds the balance in another currency than the customer paid", () => {
    expect(mapPaidSession(session, intent({}, { currency: "usd", amount: 8300, fee: 280, net: 8020 }))).toEqual({ ok: false, reason: "settlementCurrency", sessionId: "cs_test_a1B2c3D4" });
  });

  it("is refused, not guessed, when the figures do not add up or do not have the documented shape", () => {
    const bad: [string, unknown, unknown][] = [
      ["net is not gross minus fee", session, intent({}, { net: 11136 })],
      ["the intent got another amount", session, intent({ amount_received: 11000 })],
      ["the intent is in another currency", session, intent({ currency: "usd" })],
      ["the balance transaction has another amount", session, intent({}, { amount: 11000, net: 10637 })],
      ["the intent is another session's", session, intent({ id: "pi_other_0000" })],
      ["a session with no payment intent", { ...session, payment_intent: null }, intent()],
      ["a session with no amount", { ...session, amount_total: null }, intent()],
      ["a fractional amount", { ...session, amount_total: 114.98 }, intent()],
      ["a session id that is not one", { ...session, id: "sess_1" }, intent()],
      ["nothing", null, intent()],
      ["no intent", session, undefined],
      ["an expanded intent where an id is expected", { ...session, payment_intent: { id: "pi_3MtwBwLkdIwHu7ix28a3tqPa" } }, intent()],
    ];
    for (const [label, s, i] of bad) expect(() => mapPaidSession(s, i), label).toThrow(TypeError);
  });
});

describe("a payment that can or cannot be booked on its link", () => {
  const link = { amountCents: 11498n, currency: "CAD" };
  const paid = { grossCents: 11498n, feeCents: 363n, currency: "CAD" };
  it("agrees on the amount and the currency, and keeps the fee within the gross", () => {
    expect(paymentProblem(link, paid)).toBeNull();
    expect(paymentProblem(link, { ...paid, feeCents: 0n })).toBeNull();
    expect(paymentProblem(link, { ...paid, feeCents: 11498n })).toBeNull();
    expect(paymentProblem(link, { ...paid, currency: "USD" })).toBe("onlinePayments.currency");
    expect(paymentProblem(link, { ...paid, grossCents: 11497n })).toBe("onlinePayments.amount");
    expect(paymentProblem(link, { ...paid, grossCents: 11499n })).toBe("onlinePayments.amount");
    expect(paymentProblem(link, { ...paid, feeCents: -1n })).toBe("onlinePayments.fee");
    expect(paymentProblem(link, { ...paid, feeCents: 11499n })).toBe("onlinePayments.fee");
  });
});

describe("the day a payment is booked", () => {
  it("is the day Stripe took it in the company's time zone, summer and winter", () => {
    expect(bookingDate(new Date("2026-06-15T15:00:00Z"))).toBe("2026-06-15");
    expect(bookingDate(new Date("2026-06-16T03:59:00Z"))).toBe("2026-06-15"); // 23:59 in Toronto (UTC−4)
    expect(bookingDate(new Date("2026-06-16T04:00:00Z"))).toBe("2026-06-16");
    expect(bookingDate(new Date("2026-12-16T04:59:00Z"))).toBe("2026-12-15"); // 23:59 in Toronto (UTC−5)
    expect(bookingDate(new Date("2026-12-16T05:00:00Z"))).toBe("2026-12-16");
  });
});

describe("the reason kept on a link", () => {
  it("is a code a person can be shown, or a general one for a database rule", () => {
    expect(reviewCode("payments.exceeds")).toBe("payments.exceeds");
    expect(reviewCode("onlinePayments.amount")).toBe("onlinePayments.amount");
    expect(reviewCode("AL003")).toBe("onlinePayments.rule");
    expect(reviewCode("Invalid API key sk_live_x")).toBe("onlinePayments.rule");
    expect(reviewCode("")).toBe("onlinePayments.rule");
  });
});
