import { describe, expect, it } from "vitest";
import { ACCOUNT_CODE, accountInputSchema, CANADIAN_CHART, SUBTYPES_OF, SYSTEM_ACCOUNTS, userCreatableSubtypes } from "@/modules/ledger";

describe("starter chart of accounts", () => {
  it("has unique, well-formed codes and names in both languages", () => {
    const codes = CANADIAN_CHART.map((account) => account.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const account of CANADIAN_CHART) {
      expect(account.code).toMatch(ACCOUNT_CODE);
      expect(account.nameFr.trim()).not.toBe("");
      expect(account.nameEn.trim()).not.toBe("");
    }
  });

  it("respects the database rule: the subtype belongs to the type", () => {
    for (const account of CANADIAN_CHART) expect(SUBTYPES_OF[account.type], account.code).toContain(account.subtype);
  });

  it("carries each of the five system accounts exactly once, with the subtype the database expects", () => {
    for (const key of SYSTEM_ACCOUNTS) expect(CANADIAN_CHART.filter((account) => account.systemKey === key), key).toHaveLength(1);
    const bySystemKey = Object.fromEntries(CANADIAN_CHART.filter((a) => a.systemKey).map((a) => [a.systemKey, a]));
    expect(bySystemKey.ACCOUNTS_RECEIVABLE?.subtype).toBe("ACCOUNTS_RECEIVABLE");
    expect(bySystemKey.ACCOUNTS_PAYABLE?.subtype).toBe("ACCOUNTS_PAYABLE");
    expect(bySystemKey.RETAINED_EARNINGS?.subtype).toBe("RETAINED_EARNINGS");
    expect(bySystemKey.OPENING_BALANCE_EQUITY?.subtype).toBe("EQUITY");
    expect(["CASH", "CURRENT_ASSET"]).toContain(bySystemKey.UNDEPOSITED_FUNDS?.subtype);
    // the only receivable and the only payable subtypes are the control accounts
    expect(CANADIAN_CHART.filter((a) => a.subtype === "ACCOUNTS_RECEIVABLE")).toHaveLength(1);
    expect(CANADIAN_CHART.filter((a) => a.subtype === "ACCOUNTS_PAYABLE")).toHaveLength(1);
  });

  it("covers the five account types, and the tax accounts of the GST and QST", () => {
    for (const type of ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"] as const) expect(CANADIAN_CHART.some((a) => a.type === type), type).toBe(true);
    expect(CANADIAN_CHART.filter((a) => a.subtype === "SALES_TAX").map((a) => a.code)).toEqual(["1200", "1210", "2100", "2110"]);
  });
});

describe("account input", () => {
  const valid = { code: "6200", nameFr: "Frais divers", nameEn: "Sundry expenses", type: "EXPENSE", subtype: "OPERATING_EXPENSE" };

  it("accepts a normal account and trims names", () => {
    const parsed = accountInputSchema.parse({ ...valid, nameFr: "  Frais divers  " });
    expect(parsed.nameFr).toBe("Frais divers");
  });

  it("refuses a bad code, empty names, and a subtype of another type", () => {
    for (const code of ["", " ", "-1", "a b", "x".repeat(21), "é1"]) expect(accountInputSchema.safeParse({ ...valid, code }).success, code).toBe(false);
    expect(accountInputSchema.safeParse({ ...valid, nameFr: " " }).success).toBe(false);
    expect(accountInputSchema.safeParse({ ...valid, nameEn: "" }).success).toBe(false);
    expect(accountInputSchema.safeParse({ ...valid, subtype: "BANK" }).success).toBe(false);
  });

  it("does not let a user create control, tax or retained-earnings accounts", () => {
    for (const [type, subtype] of [["ASSET", "ACCOUNTS_RECEIVABLE"], ["LIABILITY", "ACCOUNTS_PAYABLE"], ["LIABILITY", "SALES_TAX"], ["EQUITY", "RETAINED_EARNINGS"]] as const) {
      expect(accountInputSchema.safeParse({ ...valid, type, subtype }).success, subtype).toBe(false);
    }
    expect(userCreatableSubtypes("ASSET")).not.toContain("ACCOUNTS_RECEIVABLE");
    expect(userCreatableSubtypes("EXPENSE")).toEqual(["COST_OF_SALES", "OPERATING_EXPENSE", "OTHER_EXPENSE"]);
  });
});
