import { describe, expect, it } from "vitest";
import { PAYMENT_METHODS, acceptsReceipts, receiptSchema, receiptVoidSchema, settlementStatus } from "@/modules/payments";

const ID = "00000000-0000-7000-8000-00000000a100";
const valid = { invoiceId: ID, amountCents: "11498", expectedOpenCents: "11498", date: "2026-06-15", accountId: ID, method: "EFT" };

describe("receipt input", () => {
  it("reads cents as digits into a bigint, and trims the optional texts", () => {
    const parsed = receiptSchema.parse({ ...valid, reference: "  Chèque 1042 ", memo: "   " });
    expect(parsed.amountCents).toBe(11498n);
    expect(parsed.expectedOpenCents).toBe(11498n);
    expect(parsed).toMatchObject({ reference: "Chèque 1042", memo: null });
    expect(receiptSchema.parse(valid)).toMatchObject({ reference: null, memo: null });
  });

  it("keeps a 15-digit amount exact, which a float cannot", () => {
    expect(receiptSchema.parse({ ...valid, amountCents: "99999999999999" }).amountCents).toBe(99_999_999_999_999n);
  });

  it.each([
    ["zero", { amountCents: "0" }],
    ["negative", { amountCents: "-1" }],
    ["decimal", { amountCents: "1.5" }],
    ["exponent", { amountCents: "1e3" }],
    ["spaces inside", { amountCents: "1 000" }],
    ["above the ceiling", { amountCents: "100000000000001" }],
    ["too many digits", { amountCents: "1000000000000000" }],
    ["no expected balance", { expectedOpenCents: "" }],
    ["unknown method", { method: "CRYPTO" }],
    ["not a date", { date: "15/06/2026" }],
    ["not an id", { invoiceId: "F-00001" }],
    ["long reference", { reference: "x".repeat(101) }],
    ["long memo", { memo: "x".repeat(501) }],
  ])("rejects %s", (_label, over) => {
    expect(receiptSchema.safeParse({ ...valid, ...over }).success).toBe(false);
  });

  it("offers exactly the methods of the database enum", () => {
    expect([...PAYMENT_METHODS]).toEqual(["CASH", "CHEQUE", "EFT", "INTERAC", "CREDIT_CARD", "DEBIT_CARD", "OTHER"]);
  });

  it("needs a reason for a void, within 500 characters", () => {
    expect(receiptVoidSchema.safeParse({ date: "2026-06-20", reason: " Chèque sans provision " }).data?.reason).toBe("Chèque sans provision");
    for (const reason of ["", "   ", "x".repeat(501)]) expect(receiptVoidSchema.safeParse({ date: "2026-06-20", reason }).success).toBe(false);
    expect(receiptVoidSchema.safeParse({ date: "demain", reason: "Erreur" }).success).toBe(false);
  });
});

describe("where a customer's money can go", () => {
  const account = (subtype: string, systemKey: string | null = null, isActive = true) => ({ subtype, systemKey, isActive });
  it("accepts bank, cash and the undeposited funds account", () => {
    expect(acceptsReceipts(account("BANK"))).toBe(true);
    expect(acceptsReceipts(account("CASH"))).toBe(true);
    expect(acceptsReceipts(account("CURRENT_ASSET", "UNDEPOSITED_FUNDS"))).toBe(true);
  });
  it("refuses every other account, and any inactive one", () => {
    for (const subtype of ["ACCOUNTS_RECEIVABLE", "OPERATING_REVENUE", "CREDIT_CARD", "FIXED_ASSET", "SALES_TAX"]) expect(acceptsReceipts(account(subtype)), subtype).toBe(false);
    expect(acceptsReceipts(account("CURRENT_ASSET"))).toBe(false); // prepaid expenses and the like
    expect(acceptsReceipts(account("BANK", null, false))).toBe(false);
    expect(acceptsReceipts(account("CURRENT_ASSET", "UNDEPOSITED_FUNDS", false))).toBe(false);
  });
});

describe("how settled an invoice is", () => {
  it("is unpaid, partial or paid by the open balance, whether payments or credit notes reduced it", () => {
    expect(settlementStatus(11498n, 11498n)).toBe("UNPAID");
    expect(settlementStatus(11498n, 11497n)).toBe("PARTIAL");
    expect(settlementStatus(11498n, 1n)).toBe("PARTIAL");
    expect(settlementStatus(11498n, 0n)).toBe("PAID");
    expect(settlementStatus(0n, 0n)).toBe("PAID");
  });
});
