import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseCredentials, parseStoredCredentials } from "@/modules/integrations/domain/credentials";
import { mapPayPalTransaction, parsePayPalDate } from "@/modules/integrations/domain/paypal";
import { mapStripeBalanceTransaction } from "@/modules/integrations/domain/stripe";
import { accountingDate, cleanText, decimalToCents, supportsCents } from "@/modules/integrations/domain/transaction";
import { DAY_MS, OVERLAP_MS, WINDOW_DAYS, syncStart, windows } from "@/modules/integrations/domain/windows";

// Stripe fixture: the documented BalanceTransaction fields.
const charge = { id: "txn_1MiN3gLkdIwHu7ixxapQrznl", object: "balance_transaction", amount: 10000, available_on: 1678043844, created: 1781500000, currency: "cad", description: "Facture F-00002", exchange_rate: null, fee: 320, fee_details: [], net: 9680, reporting_category: "charge", source: "ch_3MmlLrLkdIwHu7ix0snN0B15", status: "available", type: "charge" };
const ok = (m: ReturnType<typeof mapStripeBalanceTransaction>) => {
  if (!m.ok) throw new Error(`skipped: ${m.reason}`);
  return m.transaction;
};

describe("exact money", () => {
  it("reads decimal strings in exact cents", () => {
    expect(decimalToCents("465.00")).toBe(46500n);
    expect(decimalToCents("-13.79")).toBe(-1379n);
    expect(decimalToCents("5")).toBe(500n);
    expect(decimalToCents("0.5")).toBe(50n);
    expect(decimalToCents("13.7900")).toBe(1379n); // trailing zeros are the same amount
    expect(decimalToCents("-0.01")).toBe(-1n);
    expect(decimalToCents("999999999999999.99")).toBe(99_999_999_999_999_999n);
  });
  it.each(["", "abc", "1,5", "1.234", "1.", ".5", "--1", "1e3", "1 000", "9999999999999999", "+5"])("rejects %j", (text) => {
    expect(decimalToCents(text)).toBeNull();
  });
  it("property: any whole number of cents written with two decimals reads back the same", () => {
    fc.assert(fc.property(fc.bigInt({ min: -99_999_999_999_999n, max: 99_999_999_999_999n }), (cents) => {
      const sign = cents < 0n ? "-" : "";
      const magnitude = cents < 0n ? -cents : cents;
      const text = `${sign}${magnitude / 100n}.${(magnitude % 100n).toString().padStart(2, "0")}`;
      expect(decimalToCents(text)).toBe(cents);
    }));
  });
  it("keeps two-decimal currencies and leaves out the others instead of scaling them wrongly", () => {
    for (const currency of ["CAD", "USD", "EUR", "GBP", "MXN"]) expect(supportsCents(currency), currency).toBe(true);
    for (const currency of ["JPY", "KRW", "VND", "CLP", "KWD", "BHD", "TND"]) expect(supportsCents(currency), currency).toBe(false);
    for (const bad of ["cad", "CA", "CADD", ""]) expect(supportsCents(bad), bad).toBe(false);
  });
});

describe("dates and texts", () => {
  it("dates a transaction in the company's time zone, summer and winter", () => {
    expect(accountingDate(new Date("2026-06-16T03:30:00Z"))).toBe("2026-06-15"); // 23:30 EDT
    expect(accountingDate(new Date("2026-06-16T04:00:00Z"))).toBe("2026-06-16"); // midnight EDT
    expect(accountingDate(new Date("2026-12-16T04:59:00Z"))).toBe("2026-12-15"); // 23:59 EST
    expect(accountingDate(new Date("2026-12-16T05:00:00Z"))).toBe("2026-12-16");
  });
  it("reads PayPal's dates, with the offset written with or without a colon", () => {
    expect(parsePayPalDate("2026-06-01T04:03:52+0000")?.toISOString()).toBe("2026-06-01T04:03:52.000Z");
    expect(parsePayPalDate("2026-06-01T04:03:52+00:00")?.toISOString()).toBe("2026-06-01T04:03:52.000Z");
    expect(parsePayPalDate("2026-06-01T04:03:52Z")?.toISOString()).toBe("2026-06-01T04:03:52.000Z");
    expect(parsePayPalDate("2026-06-01T00:00:00-0700")?.toISOString()).toBe("2026-06-01T07:00:00.000Z");
    expect(parsePayPalDate("2026-06-01T05:30:00.250+0530")?.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    for (const bad of ["", "2026-06-01", "yesterday", "2026-06-01T04:03:52"]) expect(parsePayPalDate(bad), bad).toBeNull();
  });
  it("cleans a text: no control characters, one line, a bounded length", () => {
    expect(cleanText("  Facture\n\tF-00002\u0000 \u007f ", 50)).toBe("Facture F-00002");
    expect(cleanText("x".repeat(300), 200)).toHaveLength(200);
    expect(cleanText("x".repeat(300), 200).endsWith("…")).toBe(true);
    expect(cleanText(undefined, 10)).toBe("");
    expect(cleanText(42, 10)).toBe("");
  });
});

describe("Stripe balance transactions", () => {
  it("turns a charge into its net effect, with gross and fee beside it", () => {
    const t = ok(mapStripeBalanceTransaction(charge));
    expect(t).toMatchObject({ externalId: "stripe:txn_1MiN3gLkdIwHu7ixxapQrznl", amountCents: 9680n, grossCents: 10000n, feeCents: 320n, currency: "CAD", sourceType: "charge", description: "Facture F-00002" });
    expect(t.details).toMatchObject({ kind: "PAYMENT", reportingCategory: "charge", source: "ch_3MmlLrLkdIwHu7ix0snN0B15", rawAmount: 10000, rawFee: 320, rawNet: 9680 });
    expect(t.date).toBe(accountingDate(new Date(charge.created * 1000)));
  });
  it("classifies refunds, payouts, fees, disputes and adjustments, and keeps the rest as OTHER", () => {
    const kind = (over: object) => ok(mapStripeBalanceTransaction({ ...charge, amount: -500, fee: 0, net: -500, ...over })).details.kind;
    expect(kind({ reporting_category: "refund", type: "refund" })).toBe("REFUND");
    expect(kind({ reporting_category: "payout", type: "payout" })).toBe("PAYOUT");
    expect(kind({ reporting_category: "fee", type: "stripe_fee" })).toBe("FEE");
    expect(kind({ reporting_category: "dispute", type: "adjustment" })).toBe("DISPUTE");
    expect(kind({ reporting_category: "other_adjustment", type: "adjustment" })).toBe("ADJUSTMENT");
    expect(kind({ reporting_category: null, type: "payment_refund" })).toBe("REFUND");
    expect(kind({ reporting_category: "something_new", type: "something_new" })).toBe("OTHER");
  });
  it("keeps a foreign currency tagged and skips the ones without cents", () => {
    expect(ok(mapStripeBalanceTransaction({ ...charge, currency: "usd" })).currency).toBe("USD");
    expect(mapStripeBalanceTransaction({ ...charge, currency: "jpy" })).toEqual({ ok: false, reason: "unsupportedCurrency" });
    expect(mapStripeBalanceTransaction({ ...charge, currency: "kwd" })).toEqual({ ok: false, reason: "unsupportedCurrency" });
  });
  it("names a transaction without a description after its type", () => {
    expect(ok(mapStripeBalanceTransaction({ ...charge, description: null, type: "payout", reporting_category: "payout", amount: -9680, fee: 0, net: -9680 })).description).toBe("Stripe payout");
  });
  it("refuses a record that is not what Stripe documents, or whose figures do not add up", () => {
    for (const bad of [
      { ...charge, net: 9681 }, // net ≠ amount − fee
      { ...charge, id: "ch_123" },
      { ...charge, amount: 100.5 },
      { ...charge, amount: "10000" },
      { ...charge, currency: "CAD" },
      { ...charge, created: 0 },
      { ...charge, type: undefined },
      null,
      "txn_1",
    ]) expect(() => mapStripeBalanceTransaction(bad), JSON.stringify(bad)).toThrow(TypeError);
  });
  it("property: gross − fee = net = the amount kept (the rule the database checks)", () => {
    fc.assert(fc.property(fc.integer({ min: -1_000_000_000, max: 1_000_000_000 }), fc.integer({ min: -100_000, max: 100_000 }), (amount, fee) => {
      const t = ok(mapStripeBalanceTransaction({ ...charge, amount, fee, net: amount - fee }));
      expect(t.grossCents - t.feeCents).toBe(t.amountCents);
      expect(t.amountCents).toBe(BigInt(amount - fee));
    }));
  });
});

// PayPal fixture: the documented transaction_info fields; a payment received with a fee charged.
const info = (over: Record<string, unknown> = {}) => ({
  transaction_id: "7WY54567JY234567N", transaction_event_code: "T0006", transaction_initiation_date: "2026-06-01T04:03:52+0000", transaction_updated_date: "2026-06-01T04:03:53+0000",
  transaction_amount: { currency_code: "CAD", value: "465.00" }, fee_amount: { currency_code: "CAD", value: "-13.79" }, transaction_status: "S",
  transaction_subject: "Facture F-00002", invoice_id: "F-00002", ...over,
});
const paypal = (over?: Record<string, unknown>) => ok(mapPayPalTransaction(info(over)));

describe("PayPal transactions", () => {
  it("turns a payment with its fee into the net effect on the balance", () => {
    const t = paypal();
    expect(t).toMatchObject({ externalId: "paypal:7WY54567JY234567N:T0006", amountCents: 45121n, grossCents: 46500n, feeCents: 1379n, currency: "CAD", sourceType: "T0006", description: "Facture F-00002", date: "2026-06-01" });
    expect(t.details).toMatchObject({ kind: "PAYMENT", status: "S", reference: "F-00002", rawAmount: "465.00", rawFee: "-13.79", unusualFeeSign: false });
    expect(t.grossCents - t.feeCents).toBe(t.amountCents);
  });
  it("takes a refund that gives the fee back, and a payment without a fee", () => {
    const refund = paypal({ transaction_event_code: "T1107", transaction_amount: { currency_code: "CAD", value: "-465.00" }, fee_amount: { currency_code: "CAD", value: "13.79" } });
    expect(refund).toMatchObject({ amountCents: -45121n, grossCents: -46500n, feeCents: -1379n });
    expect(refund.details).toMatchObject({ kind: "REFUND", unusualFeeSign: false });
    const free = paypal({ fee_amount: undefined });
    expect(free).toMatchObject({ amountCents: 46500n, feeCents: 0n });
  });
  it("flags a fee whose sign is not the one expected, and still keeps the raw text", () => {
    const t = paypal({ fee_amount: { currency_code: "CAD", value: "13.79" } }); // a positive fee on a payment received
    expect(t.details).toMatchObject({ unusualFeeSign: true, rawFee: "13.79" });
    expect(t.amountCents).toBe(46500n + 1379n); // arithmetic of the stated convention: visible, flagged, correctable
  });
  it("dates the transaction in the company's time zone", () => {
    expect(paypal({ transaction_initiation_date: "2026-06-16T03:30:00+0000" }).date).toBe("2026-06-15");
    expect(paypal({ transaction_initiation_date: "2026-06-15T21:00:00-0700" }).date).toBe("2026-06-16"); // 04:00 UTC = 00:00 EDT
  });
  it("leaves out what is not settled, and what has no cents", () => {
    for (const status of ["P", "D"]) expect(mapPayPalTransaction(info({ transaction_status: status })), status).toEqual({ ok: false, reason: "notSettled" });
    expect(mapPayPalTransaction(info({ transaction_status: "V" })).ok).toBe(true); // reversed: it did move the balance
    expect(mapPayPalTransaction(info({ transaction_amount: { currency_code: "JPY", value: "5000" }, fee_amount: { currency_code: "JPY", value: "-180" } }))).toEqual({ ok: false, reason: "unsupportedCurrency" });
  });
  it("describes a transaction by its subject, then its note, then its code, and keeps a reference when there is one", () => {
    expect(paypal({ transaction_subject: undefined, transaction_note: "Note du vendeur" }).description).toBe("Note du vendeur");
    expect(paypal({ transaction_subject: undefined, transaction_note: undefined }).description).toBe("PayPal T0006");
    expect(paypal({ invoice_id: undefined, custom_field: "commande-7" }).details.reference).toBe("commande-7");
    expect(paypal({ invoice_id: undefined, custom_field: undefined }).details.reference).toBeNull();
  });
  it("refuses a record that is not what PayPal documents", () => {
    for (const bad of [
      info({ transaction_amount: { currency_code: "CAD", value: "12,50" } }),
      info({ transaction_amount: { currency_code: "CAD", value: "1.234" } }),
      info({ transaction_amount: { currency_code: "cad", value: "1.00" } }),
      info({ fee_amount: { currency_code: "USD", value: "-1.00" } }),
      info({ transaction_event_code: "payment" }),
      info({ transaction_initiation_date: "hier" }),
      info({ transaction_id: "" }),
      {},
      null,
    ]) expect(() => mapPayPalTransaction(bad), JSON.stringify(bad)).toThrow(TypeError);
  });
  it("property: gross − fee = net = the amount kept", () => {
    fc.assert(fc.property(fc.integer({ min: -1_000_000_000, max: 1_000_000_000 }), fc.integer({ min: -100_000, max: 100_000 }), (gross, fee) => {
      const text = (cents: number) => `${cents < 0 ? "-" : ""}${Math.floor(Math.abs(cents) / 100)}.${String(Math.abs(cents) % 100).padStart(2, "0")}`;
      const t = paypal({ transaction_amount: { currency_code: "CAD", value: text(gross) }, fee_amount: { currency_code: "CAD", value: text(fee) } });
      expect(t.grossCents - t.feeCents).toBe(t.amountCents);
      expect(t.amountCents).toBe(BigInt(gross + fee));
    }));
  });
});

describe("sync windows", () => {
  const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
  it("starts at the first day asked for, or just before the cursor", () => {
    expect(syncStart("2026-01-01", null)).toEqual(day("2026-01-01"));
    expect(syncStart("2026-01-01", day("2026-03-10"))).toEqual(new Date(day("2026-03-10").getTime() - OVERLAP_MS));
    expect(syncStart("2026-03-09", day("2026-03-10"))).toEqual(day("2026-03-09")); // never before the first day asked for
  });
  it("covers the whole period in consecutive windows of at most 31 days, oldest first", () => {
    const start = day("2026-01-01");
    const end = new Date("2026-06-15T12:00:00Z");
    const all = windows(start, end, 100);
    expect(all[0]?.from).toEqual(start);
    expect(all.at(-1)?.to).toEqual(end);
    for (let i = 1; i < all.length; i++) expect(all[i]?.from).toEqual(all[i - 1]?.to);
    for (const w of all) expect(w.to.getTime() - w.from.getTime()).toBeLessThanOrEqual(WINDOW_DAYS * DAY_MS);
    expect(all).toHaveLength(Math.ceil((end.getTime() - start.getTime()) / (WINDOW_DAYS * DAY_MS)));
  });
  it("makes no window for an empty period and respects the per-run cap", () => {
    expect(windows(day("2026-06-15"), day("2026-06-15"), 10)).toEqual([]);
    expect(windows(day("2026-06-16"), day("2026-06-15"), 10)).toEqual([]);
    expect(windows(day("2020-01-01"), day("2026-01-01"), 3)).toHaveLength(3);
  });
});

describe("credentials", () => {
  const sk = `sk_live_${"a1B2c3D4e5".repeat(3)}`;
  it("takes a Stripe secret or restricted key, and tells test from live by the key", () => {
    expect(parseCredentials("STRIPE", { apiKey: sk })).toMatchObject({ hint: sk.slice(-4), sandbox: false });
    expect(parseCredentials("STRIPE", { apiKey: ` rk_test_${"Z9y8".repeat(8)} ` })).toMatchObject({ sandbox: true });
  });
  it("refuses a publishable key, a short one and anything else", () => {
    for (const apiKey of [`pk_live_${"a".repeat(30)}`, "sk_live_short", `sk_prod_${"a".repeat(30)}`, `sk_live_${"a".repeat(30)}\n--x`, "", `Bearer ${sk}`]) {
      expect(parseCredentials("STRIPE", { apiKey }), apiKey).toBeNull();
    }
    expect(parseCredentials("STRIPE", {})).toBeNull();
    expect(parseCredentials("STRIPE", null)).toBeNull();
  });
  it("takes a PayPal client id and secret; the person picks the environment", () => {
    const clientId = "AeA1QIZXiflr1_-r0U2UbWTziOWX1GRl2qs2-t1k";
    const parsed = parseCredentials("PAYPAL", { clientId, clientSecret: "EBWKjlELKMYqRNQ6sYvFo64FtaRLRR5BdHEESmha49TM" });
    expect(parsed).toMatchObject({ provider: "PAYPAL", hint: clientId.slice(-4), sandbox: null });
    expect(parseCredentials("PAYPAL", { clientId: "short", clientSecret: "short" })).toBeNull();
    expect(parseCredentials("PAYPAL", { clientId })).toBeNull();
  });
  it("reads stored credentials with the same rules, and refuses a damaged blob", () => {
    expect(parseStoredCredentials("STRIPE", JSON.stringify({ apiKey: sk }))).toEqual({ apiKey: sk });
    for (const damaged of ["", "not json", "{}", JSON.stringify({ apiKey: "pk_live_nope" }), "null"]) expect(parseStoredCredentials("STRIPE", damaged), damaged).toBeNull();
  });
});
