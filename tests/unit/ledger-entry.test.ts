import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  accountingEquationHolds,
  acceptsManualEntries,
  checkEntry,
  isBalanced,
  MAX_ENTRY_LINES,
  MAX_LINE_CENTS,
  naturalBalance,
  reversalLines,
  totalsByType,
  trialBalance,
  type AccountType,
  type EntryLine,
} from "@/modules/ledger";

const accountIds = ["a1", "a2", "a3", "a4", "a5", "a6"] as const;
const types: Record<(typeof accountIds)[number], AccountType> = { a1: "ASSET", a2: "ASSET", a3: "LIABILITY", a4: "EQUITY", a5: "REVENUE", a6: "EXPENSE" };
const accounts = accountIds.map((id) => ({ id, type: types[id] }));

const cents = fc.bigInt({ min: 1n, max: 1_000_000_000n });
const account = fc.constantFrom(...accountIds);

/** A balanced entry: draw a total, split it among 1-10 debits and 1-10 credits (the generator of the test plan). */
const split = (total: bigint, parts: number, weights: number[]): bigint[] => {
  const used = weights.slice(0, parts).map((w) => w + 1);
  const sum = used.reduce((a, b) => a + b, 0);
  const shares = used.map((w) => (total * BigInt(w)) / BigInt(sum));
  const remainder = total - shares.reduce((a, b) => a + b, 0n);
  shares[0] = (shares[0] ?? 0n) + remainder;
  return shares.filter((share) => share > 0n);
};

const balancedEntry: fc.Arbitrary<EntryLine[]> = fc
  .record({
    total: fc.bigInt({ min: 2n, max: 1_000_000_000_000n }),
    debitParts: fc.integer({ min: 1, max: 10 }),
    creditParts: fc.integer({ min: 1, max: 10 }),
    weights: fc.array(fc.nat(20), { minLength: 10, maxLength: 10 }),
    debitAccounts: fc.array(account, { minLength: 10, maxLength: 10 }),
    creditAccounts: fc.array(account, { minLength: 10, maxLength: 10 }),
  })
  .map(({ total, debitParts, creditParts, weights, debitAccounts, creditAccounts }) => {
    const debits = split(total, debitParts, weights);
    const credits = split(total, creditParts, [...weights].reverse());
    return [
      ...debits.map((amount, i) => ({ accountId: debitAccounts[i] ?? "a1", debitCents: amount, creditCents: 0n })),
      ...credits.map((amount, i) => ({ accountId: creditAccounts[i] ?? "a2", debitCents: 0n, creditCents: amount })),
    ];
  });

describe("entry validation", () => {
  const line = (debit: bigint, credit: bigint, accountId = "a1"): EntryLine => ({ accountId, debitCents: debit, creditCents: credit });

  it("accepts a balanced entry", () => {
    expect(checkEntry([line(100n, 0n), line(0n, 100n, "a2")])).toEqual([]);
  });

  it("refuses an entry with fewer than two lines", () => {
    expect(checkEntry([])).toEqual([{ code: "tooFewLines" }]);
    expect(checkEntry([line(100n, 0n)])).toEqual([{ code: "tooFewLines" }, { code: "unbalanced", debitCents: 100n, creditCents: 0n }]);
  });

  it("names each line problem and skips the balance when a line is wrong", () => {
    expect(checkEntry([line(100n, 100n), line(0n, 0n, "a2"), line(-1n, 0n, "a3")])).toEqual([
      { code: "bothSides", line: 1 },
      { code: "noAmount", line: 2 },
      { code: "negativeAmount", line: 3 },
    ]);
    expect(checkEntry([line(MAX_LINE_CENTS + 1n, 0n), line(0n, MAX_LINE_CENTS + 1n, "a2")])).toEqual([
      { code: "tooLarge", line: 1 },
      { code: "tooLarge", line: 2 },
    ]);
    expect(checkEntry(Array.from({ length: MAX_ENTRY_LINES + 2 }, (_, i) => line(i % 2 === 0 ? 1n : 0n, i % 2 === 0 ? 0n : 1n)))).toEqual([{ code: "tooManyLines" }]);
  });

  it("P1/P2 property: a generated balanced entry is accepted, with δ ≠ 0 added it is refused", () => {
    fc.assert(
      fc.property(balancedEntry, fc.bigInt({ min: 1n, max: 1_000_000n }), (lines, delta) => {
        expect(checkEntry(lines)).toEqual([]);
        const off = [...lines, { accountId: "a1", debitCents: delta, creditCents: 0n }];
        expect(checkEntry(off).map((problem) => problem.code)).toEqual(["unbalanced"]);
      }),
    );
  });

  it("P2 property: zero or one line is always refused", () => {
    fc.assert(
      fc.property(fc.array(account, { maxLength: 1 }), cents, (ids, amount) => {
        const lines = ids.map((id) => ({ accountId: id, debitCents: amount, creditCents: 0n }));
        expect(checkEntry(lines).map((problem) => problem.code)).toContain("tooFewLines");
      }),
    );
  });
});

describe("trial balance and accounting equation", () => {
  it("P1 property: after any sequence of valid entries, total debits = total credits", () => {
    fc.assert(
      fc.property(fc.array(balancedEntry, { minLength: 1, maxLength: 20 }), (entries) => {
        expect(isBalanced(trialBalance(entries.flat()))).toBe(true);
      }),
    );
  });

  it("P3 property: an entry followed by its reversal leaves every balance unchanged", () => {
    fc.assert(
      fc.property(fc.array(balancedEntry, { minLength: 1, maxLength: 8 }), balancedEntry, (before, entry) => {
        const snapshot = (lines: EntryLine[]) => new Map(trialBalance(lines).map((row) => [row.accountId, row.debitCents - row.creditCents]));
        const base = snapshot(before.flat());
        const after = snapshot([...before.flat(), ...entry, ...reversalLines(entry)]);
        for (const [id, net] of after) expect(net).toBe(base.get(id) ?? 0n);
        for (const [id, net] of base) expect(after.get(id)).toBe(net);
      }),
    );
  });

  it("reversing twice gives back the original lines", () => {
    fc.assert(
      fc.property(balancedEntry, (entry) => {
        expect(reversalLines(reversalLines(entry))).toEqual(entry);
      }),
    );
  });

  it("P8 property: assets = liabilities + equity + (revenue - expenses) after any sequence of entries", () => {
    fc.assert(
      fc.property(fc.array(balancedEntry, { minLength: 1, maxLength: 20 }), (entries) => {
        const totals = totalsByType(trialBalance(entries.flat()), accounts);
        expect(accountingEquationHolds(totals)).toBe(true);
      }),
    );
  });

  it("gives each type its natural direction", () => {
    expect(naturalBalance("ASSET", { debitCents: 500n, creditCents: 200n })).toBe(300n);
    expect(naturalBalance("EXPENSE", { debitCents: 500n, creditCents: 200n })).toBe(300n);
    expect(naturalBalance("LIABILITY", { debitCents: 200n, creditCents: 500n })).toBe(300n);
    expect(naturalBalance("REVENUE", { debitCents: 0n, creditCents: 500n })).toBe(500n);
    expect(() => totalsByType([{ accountId: "zz", debitCents: 1n, creditCents: 0n }], accounts)).toThrow(RangeError);
  });
});

describe("accounts for manual entries", () => {
  it("excludes control accounts, tax accounts and inactive accounts", () => {
    expect(acceptsManualEntries({ subtype: "BANK", isActive: true })).toBe(true);
    expect(acceptsManualEntries({ subtype: "OPERATING_EXPENSE", isActive: true })).toBe(true);
    expect(acceptsManualEntries({ subtype: "ACCOUNTS_RECEIVABLE", isActive: true })).toBe(false);
    expect(acceptsManualEntries({ subtype: "ACCOUNTS_PAYABLE", isActive: true })).toBe(false);
    expect(acceptsManualEntries({ subtype: "SALES_TAX", isActive: true })).toBe(false);
    expect(acceptsManualEntries({ subtype: "BANK", isActive: false })).toBe(false);
  });
});
