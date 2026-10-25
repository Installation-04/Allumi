/** The most lines a reconciliation shows and saves at once: past this the worksheet would be unusable, so it is refused. */
export const MAX_WORKSHEET_LINES = 5000;

/**
 * A statement balance is what the statement says: the money in an account, or what is owed on a card. The ledger
 * adds up debit − credit, which is the other way round for a liability: one sign converts between the two.
 */
export const balanceSign = (accountType: string): 1n | -1n => (accountType === "LIABILITY" ? -1n : 1n);

/** What is left to explain, in ledger terms: zero when the ticked lines (and those of earlier statements) are the statement's balance. */
export const reconciliationDifference = (statementLedgerCents: bigint, previousCents: bigint, tickedCents: bigint): bigint => statementLedgerCents - previousCents - tickedCents;

export type DateProblem = "order";

/** A statement is for a day after the last one reconciled on the account (the database says the same). */
export function statementDateProblem(statementDate: string, lastCompletedDate: string | null): DateProblem | null {
  return lastCompletedDate !== null && statementDate <= lastCompletedDate ? "order" : null;
}

export type LineProblem = "account" | "after";

/** A line can be counted by a reconciliation only on its account and on or before the statement's day (the database says the same). */
export function lineProblem(line: { accountId: string; entryDate: string }, reconciliation: { accountId: string; statementDate: string }): LineProblem | null {
  if (line.accountId !== reconciliation.accountId) return "account";
  return line.entryDate > reconciliation.statementDate ? "after" : null;
}
