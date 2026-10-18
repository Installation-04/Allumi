import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { isBalanced, netColumns, trialBalance } from "@/modules/ledger";

describe("netColumns (what the trial balance prints for an account)", () => {
  it("puts the net balance in one column only", () => {
    expect(netColumns({ debitCents: 100_000n, creditCents: 25_000n })).toEqual({ debitCents: 75_000n, creditCents: 0n });
    expect(netColumns({ debitCents: 25_000n, creditCents: 100_000n })).toEqual({ debitCents: 0n, creditCents: 75_000n });
    expect(netColumns({ debitCents: 500n, creditCents: 500n })).toEqual({ debitCents: 0n, creditCents: 0n });
    expect(netColumns({ debitCents: 0n, creditCents: 0n })).toEqual({ debitCents: 0n, creditCents: 0n });
  });

  it("keeps the two printed columns equal over many entries, one side per account (P1, as printed)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.constantFrom("a", "b", "c", "d"), fc.constantFrom("a", "b", "c", "d"), fc.bigInt({ min: 1n, max: 1_000_000n })), { minLength: 1, maxLength: 30 }),
        (entries) => {
          const posted = entries.flatMap(([debit, credit, amount]) => [
            { accountId: debit, debitCents: amount, creditCents: 0n },
            { accountId: credit, debitCents: 0n, creditCents: amount },
          ]);
          const printed = trialBalance(posted).map(netColumns);
          expect(isBalanced(trialBalance(posted))).toBe(true);
          expect(printed.reduce((sum, row) => sum + row.debitCents, 0n)).toBe(printed.reduce((sum, row) => sum + row.creditCents, 0n));
          // never both columns on one account, never a negative amount
          for (const row of printed) {
            expect(row.debitCents >= 0n && row.creditCents >= 0n).toBe(true);
            expect(row.debitCents === 0n || row.creditCents === 0n).toBe(true);
          }
        },
      ),
    );
  });
});
