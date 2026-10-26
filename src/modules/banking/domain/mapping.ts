import { z } from "zod";
import { guessDecimalSeparator, parseAmount, parseStatementDate, type DateOrder, type DecimalSeparator } from "./money";
import { cleanText, MAX_DESCRIPTION, MAX_STATEMENT_ROWS, StatementError, type StatementLine } from "./statement";

const column = z.number().int().min(0).max(39);

/**
 * How the columns of a CSV statement are read. `amount` is one signed column, or two (money out and money in, as many
 * banks write them); `invertSign` flips the result for statements that show a card charge as a positive figure.
 */
export const csvMappingSchema = z
  .object({
    hasHeader: z.boolean(),
    dateColumn: column,
    dateOrder: z.enum(["YMD", "DMY", "MDY"]),
    descriptionColumns: z.array(column).min(1).max(3),
    payeeColumn: column.nullable(),
    amount: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("single"), column }).strict(),
      z.object({ kind: z.literal("split"), outColumn: column, inColumn: column }).strict(),
    ]),
    decimal: z.enum([".", ","]),
    invertSign: z.boolean(),
  })
  .strict();
export type CsvMapping = z.infer<typeof csvMappingSchema>;

export type RowErrorCode = "date" | "amount";
export type RowError = { row: number; code: RowErrorCode };

export type MappedStatement = {
  lines: StatementLine[];
  /** Rows that could not be read; the import refuses a statement that has any. Capped list, exact count. */
  errors: RowError[];
  errorCount: number;
  /** Rows with nothing in them, and rows of zero: left out, never an error. */
  skipped: number;
};

const MAX_ERRORS_LISTED = 20;
export const EMPTY_DESCRIPTION = "—";

/**
 * Reads the rows of a CSV with a mapping, in exact cents. A row whose date or amount cannot be read is an error with
 * its line number (the person fixes the mapping or the file); a row with nothing in the mapped cells, or an amount
 * of zero, is skipped and counted.
 */
export function applyCsvMapping(rows: string[][], mapping: CsvMapping): MappedStatement {
  const result: MappedStatement = { lines: [], errors: [], errorCount: 0, skipped: 0 };
  const fail = (row: number, code: RowErrorCode) => {
    result.errorCount++;
    if (result.errors.length < MAX_ERRORS_LISTED) result.errors.push({ row, code });
  };
  const used = [mapping.dateColumn, ...mapping.descriptionColumns, ...(mapping.amount.kind === "single" ? [mapping.amount.column] : [mapping.amount.outColumn, mapping.amount.inColumn])];
  rows.forEach((cells, index) => {
    if (index === 0 && mapping.hasHeader) return;
    const row = index + 1;
    const cell = (at: number) => (cells[at] ?? "").trim();
    if (used.every((at) => cell(at) === "")) {
      result.skipped++;
      return;
    }
    const date = parseStatementDate(cell(mapping.dateColumn), mapping.dateOrder);
    if (!date) return fail(row, "date");
    let cents: bigint | null;
    if (mapping.amount.kind === "single") cents = parseAmount(cell(mapping.amount.column), mapping.decimal);
    else {
      // Two columns, each a figure without a meaning of its own beyond "out" and "in": a sign inside one is ignored.
      const out = cell(mapping.amount.outColumn);
      const into = cell(mapping.amount.inColumn);
      const outCents = out === "" ? 0n : parseAmount(out, mapping.decimal);
      const inCents = into === "" ? 0n : parseAmount(into, mapping.decimal);
      const abs = (value: bigint) => (value < 0n ? -value : value);
      // Nothing in either column, an unreadable figure, or a figure in both (which way did the money go?): an error.
      cents = (out === "" && into === "") || outCents === null || inCents === null || (outCents !== 0n && inCents !== 0n) ? null : abs(inCents) - abs(outCents);
    }
    if (cents === null) return fail(row, "amount");
    if (mapping.invertSign) cents = -cents;
    if (cents === 0n) {
      result.skipped++;
      return;
    }
    const description = cleanText(mapping.descriptionColumns.map(cell).filter((text) => text !== "").join(" "), MAX_DESCRIPTION);
    const payee = mapping.payeeColumn === null ? "" : cleanText(cell(mapping.payeeColumn), MAX_DESCRIPTION);
    result.lines.push({ date, amountCents: cents, description: description || payee || EMPTY_DESCRIPTION, payee: payee || null, externalId: null });
  });
  if (result.lines.length + result.errorCount > MAX_STATEMENT_ROWS) throw new StatementError("tooLarge");
  return result;
}

const HEADER_HINTS = {
  date: /\b(date|jour)\b|^date/i,
  description: /descr|libell|détail|detail|memo|mémo|payee|bénéficiaire|beneficiaire|name|nom|transaction/i,
  amount: /amount|montant/i,
  out: /debit|débit|retrait|withdraw|sortie|paid out/i,
  into: /credit|crédit|dépôt|depot|deposit|entrée|entree|paid in/i,
};

/**
 * A first guess at the mapping from the header and the values, for the form to start from (the person checks it in
 * the preview). Null when the first row is no header and nothing in it looks like a date.
 */
export function suggestMapping(rows: string[][]): CsvMapping | null {
  const first = rows[0] ?? [];
  const body = rows.slice(1, 40);
  const find = (hint: RegExp, not?: RegExp) => first.findIndex((name) => hint.test(name) && !(not?.test(name) ?? false));
  const looksLikeDate = (value: string) => /^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}/.test(value.trim()) || /^\d{8}$/.test(value.trim());
  const hasHeader = !first.some(looksLikeDate);
  let dateColumn = hasHeader ? find(HEADER_HINTS.date) : first.findIndex(looksLikeDate);
  if (dateColumn < 0) dateColumn = (hasHeader ? body[0] : first)?.findIndex(looksLikeDate) ?? -1;
  if (dateColumn < 0) return null;
  const sample = (hasHeader ? body : rows.slice(0, 40)).map((cells) => cells[dateColumn] ?? "").filter(Boolean);
  const dateOrder = guessDateOrder(sample);
  const outColumn = hasHeader ? find(HEADER_HINTS.out) : -1;
  const inColumn = hasHeader ? find(HEADER_HINTS.into) : -1;
  const singleColumn = hasHeader ? find(HEADER_HINTS.amount) : -1;
  const wide = Math.max(...rows.slice(0, 40).map((cells) => cells.length));
  let amount: CsvMapping["amount"];
  if (outColumn >= 0 && inColumn >= 0 && outColumn !== inColumn) amount = { kind: "split", outColumn, inColumn };
  else if (singleColumn >= 0) amount = { kind: "single", column: singleColumn };
  else {
    const numeric = Array.from({ length: wide }, (_, at) => at).filter((at) => at !== dateColumn && body.filter((cells) => /^[\s$+(−-]*\d[\d\s.,]*\)?\s*-?$/.test(cells[at] ?? "")).length > body.length / 2);
    if (numeric.length === 0) return null;
    amount = { kind: "single", column: numeric[0] as number };
  }
  const taken = new Set([dateColumn, ...(amount.kind === "single" ? [amount.column] : [amount.outColumn, amount.inColumn])]);
  const named = hasHeader ? first.map((name, at) => (HEADER_HINTS.description.test(name) && !taken.has(at) ? at : -1)).filter((at) => at >= 0) : [];
  const fallback = Array.from({ length: wide }, (_, at) => at).find((at) => !taken.has(at));
  const descriptionColumns = named.length > 0 ? named.slice(0, 3) : fallback === undefined ? [] : [fallback];
  if (descriptionColumns.length === 0) return null;
  const amounts = body.map((cells) => (amount.kind === "single" ? cells[amount.column] : cells[amount.outColumn] || cells[amount.inColumn]) ?? "");
  const decimal: DecimalSeparator = guessDecimalSeparator(amounts);
  return { hasHeader, dateColumn, dateOrder, descriptionColumns, payeeColumn: null, amount, decimal, invertSign: false };
}

/** The order that makes every sampled date possible: a first part above 12 is a day, a part above 12 in the middle is a day, four digits first is a year. */
export function guessDateOrder(samples: string[]): DateOrder {
  let dayFirst = false;
  let monthFirst = false;
  for (const sample of samples) {
    const parts = /^(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,4})/.exec(sample.trim());
    if (!parts) continue;
    const [, a = "", b = ""] = parts;
    if (a.length === 4) return "YMD";
    if (Number(a) > 12) dayFirst = true;
    if (Number(b) > 12) monthFirst = true;
  }
  if (dayFirst && !monthFirst) return "DMY";
  if (monthFirst && !dayFirst) return "MDY";
  return samples.some((sample) => /^\d{8}$/.test(sample.trim())) ? "YMD" : "DMY";
}
