import type { Locale } from "@/modules/ledger/client";

/** How a spreadsheet in the language reads a CSV file: fr-CA Excel splits on `;` and reads `,` as the decimal mark. */
export type CsvFormat = { delimiter: ";" | ","; decimal: "," | "." };

export const csvFormatFor = (locale: Locale): CsvFormat => (locale === "en" ? { delimiter: ",", decimal: "." } : { delimiter: ";", decimal: "," });

/**
 * A text cell. The characters a spreadsheet would run as a formula (= + - @, tab, carriage return) at the start of a
 * cell are defused with a leading apostrophe, so a name or a description written by someone else cannot become a
 * command on the machine that opens the file. The cell is quoted when it holds the delimiter, a quote or a line break.
 */
export function csvText(value: string, format: CsvFormat): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return safe.includes(format.delimiter) || /["\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** An amount: exact, with the language's decimal mark, no thousands separator and no currency sign, so a spreadsheet reads it as a number. */
export function csvAmount(cents: bigint, format: CsvFormat): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const whole = abs / 100n;
  const fraction = (abs % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole}${format.decimal}${fraction}`;
}

/** A cell of a row: text, or an amount in cents (`bigint`). */
export type CsvCell = string | bigint;

/** The rows as CSV text: lines end with CRLF (RFC 4180), and a spreadsheet gets its byte-order mark from the caller. */
export function toCsv(rows: readonly (readonly CsvCell[])[], format: CsvFormat): string {
  return rows.map((row) => row.map((cell) => (typeof cell === "bigint" ? csvAmount(cell, format) : csvText(cell, format))).join(format.delimiter)).join("\r\n") + "\r\n";
}
