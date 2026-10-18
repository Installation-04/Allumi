import { MAX_LINE_CENTS } from "./money";

/** A line of a journal entry. Amounts are cents; exactly one of debit and credit is non-zero. */
export type EntryLine = {
  accountId: string;
  debitCents: bigint;
  creditCents: bigint;
  description?: string | null;
  contactId?: string | null;
  taxId?: string | null;
  taxBox?: string | null;
};

export const MAX_ENTRY_LINES = 500;

/**
 * Why an entry is refused. The database refuses the same cases: `tooFewLines` is AL002, `unbalanced` is
 * AL001, and the three line problems are the CHECK journal_line_one_side (SQLSTATE 23514).
 */
export type EntryProblem =
  | { code: "tooFewLines" }
  | { code: "tooManyLines" }
  | { code: "negativeAmount"; line: number }
  | { code: "tooLarge"; line: number }
  | { code: "bothSides"; line: number }
  | { code: "noAmount"; line: number }
  | { code: "unbalanced"; debitCents: bigint; creditCents: bigint };

/** Problems of an entry, in a stable order (count, then each line, then the balance). Empty = acceptable. */
export function checkEntry(lines: readonly EntryLine[]): EntryProblem[] {
  const problems: EntryProblem[] = [];
  if (lines.length < 2) problems.push({ code: "tooFewLines" });
  if (lines.length > MAX_ENTRY_LINES) problems.push({ code: "tooManyLines" });

  let debit = 0n;
  let credit = 0n;
  let lineProblem = false;
  lines.forEach((line, index) => {
    const number = index + 1;
    if (line.debitCents < 0n || line.creditCents < 0n) {
      problems.push({ code: "negativeAmount", line: number });
      lineProblem = true;
    } else if (line.debitCents > MAX_LINE_CENTS || line.creditCents > MAX_LINE_CENTS) {
      problems.push({ code: "tooLarge", line: number });
      lineProblem = true;
    } else if (line.debitCents > 0n && line.creditCents > 0n) {
      problems.push({ code: "bothSides", line: number });
      lineProblem = true;
    } else if (line.debitCents === 0n && line.creditCents === 0n) {
      problems.push({ code: "noAmount", line: number });
      lineProblem = true;
    }
    debit += line.debitCents;
    credit += line.creditCents;
  });
  if (!lineProblem && debit !== credit) problems.push({ code: "unbalanced", debitCents: debit, creditCents: credit });
  return problems;
}

export function totalDebitCents(lines: readonly EntryLine[]): bigint {
  return lines.reduce((sum, line) => sum + line.debitCents, 0n);
}

/**
 * The lines of the reversal of an entry: same accounts, contacts and tax tags, debits and credits swapped.
 * The database accepts a reversal only if it is exactly this mirror (AL008).
 */
export function reversalLines(lines: readonly EntryLine[]): EntryLine[] {
  return lines.map((line) => ({ ...line, debitCents: line.creditCents, creditCents: line.debitCents }));
}
