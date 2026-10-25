import type { EntryLine } from "@/modules/ledger/client";

/** The most lines one transaction is matched to: a statement line is a handful of entries, not a ledger. */
export const MAX_MATCHED_LINES = 20;
/** The days around a transaction in which an entry is suggested for it. */
export const SUGGESTION_DAYS = 7;
/** The days around a transfer in which the other account's transaction is looked for. */
export const TRANSFER_DAYS = 7;

export type MatchProblem = "empty" | "tooMany" | "duplicate" | "sum";

/**
 * Whether these ledger lines (each as debit − credit on the transaction's account) can be matched to a transaction:
 * at least one, not too many, none twice, and together exactly the amount of the transaction. The database checks the
 * same sum again at commit.
 */
export function matchProblem(amountCents: bigint, lines: readonly { id: string; cents: bigint }[]): MatchProblem | null {
  if (lines.length === 0) return "empty";
  if (lines.length > MAX_MATCHED_LINES) return "tooMany";
  if (new Set(lines.map((line) => line.id)).size !== lines.length) return "duplicate";
  return lines.reduce((sum, line) => sum + line.cents, 0n) === amountCents ? null : "sum";
}

/**
 * The two lines of the entry that records a statement line against another account: money in (positive) debits the
 * statement's account and credits the other one, money out does the reverse.
 */
export function categorizeLines(amountCents: bigint, bankAccountId: string, counterAccountId: string, description: string | null): EntryLine[] {
  const inflow = amountCents > 0n;
  const cents = inflow ? amountCents : -amountCents;
  return [
    { accountId: bankAccountId, debitCents: inflow ? cents : 0n, creditCents: inflow ? 0n : cents, description },
    { accountId: counterAccountId, debitCents: inflow ? 0n : cents, creditCents: inflow ? cents : 0n, description },
  ];
}

export type TransferProblem = "sameAccount" | "amounts";

/** Two statement lines are the two sides of one transfer when they are on different accounts and cancel out exactly. */
export function transferProblem(a: { accountId: string; amountCents: bigint }, b: { accountId: string; amountCents: bigint }): TransferProblem | null {
  if (a.accountId === b.accountId) return "sameAccount";
  return a.amountCents + b.amountCents === 0n && a.amountCents !== 0n ? null : "amounts";
}

/** One line per side, each on its own account: money in is a debit, money out a credit. They balance because the amounts cancel. */
export function transferLines(a: { accountId: string; amountCents: bigint }, b: { accountId: string; amountCents: bigint }, description: string | null): EntryLine[] {
  const side = (leg: { accountId: string; amountCents: bigint }): EntryLine => ({
    accountId: leg.accountId, debitCents: leg.amountCents > 0n ? leg.amountCents : 0n, creditCents: leg.amountCents < 0n ? -leg.amountCents : 0n, description,
  });
  return [side(a), side(b)];
}
