import { parseCsv } from "./csv";
import { keyLines, type KeyedLine } from "./dedupe";
import { applyCsvMapping, csvMappingSchema, suggestMapping, type CsvMapping, type RowError } from "./mapping";
import { parseOfx } from "./ofx";
import { detectFormat, StatementError } from "./statement";

export type ReadStatement = {
  format: "CSV" | "OFX";
  lines: KeyedLine[];
  /** Rows or transactions that could not be read: the import is refused while there are any. */
  errors: RowError[];
  errorCount: number;
  skipped: number;
  /** CSV: the rows of the file (for the mapping preview) and the mapping used or suggested. */
  table: string[][] | null;
  mapping: CsvMapping | null;
  /** OFX: what the file says about itself. */
  currency: string | null;
  accountMask: string | null;
  ledgerBalance: { cents: bigint; date: string } | null;
};

/**
 * A statement file read into keyed lines. An OFX file needs nothing more; a CSV needs a mapping (the one given, else a
 * suggestion from the header and the values, else none, and the person chooses the columns). Pure: the browser reads
 * the preview with it, and the server reads the file again with the same code before anything is stored.
 */
export function readStatement(text: string, options: { mapping?: unknown } = {}): ReadStatement {
  const format = detectFormat(text);
  if (format === "OFX") {
    const ofx = parseOfx(text);
    if (ofx.lines.length === 0 && ofx.errorCount === 0) throw new StatementError("noTransactions");
    return {
      format, lines: keyLines(ofx.lines), errors: [], errorCount: ofx.errorCount, skipped: ofx.skipped, table: null, mapping: null,
      currency: ofx.currency, accountMask: ofx.accountMask, ledgerBalance: ofx.ledgerBalance,
    };
  }
  const table = parseCsv(text);
  if (table.length === 0) throw new StatementError("empty");
  const given = options.mapping === undefined ? null : csvMappingSchema.safeParse(options.mapping);
  if (given && !given.success) throw new StatementError("mapping");
  const mapping = given?.data ?? suggestMapping(table);
  const base = { format, table, mapping, currency: null, accountMask: null, ledgerBalance: null } as const;
  if (!mapping) return { ...base, lines: [], errors: [], errorCount: 0, skipped: 0 };
  const mapped = applyCsvMapping(table, mapping);
  return { ...base, lines: keyLines(mapped.lines), errors: mapped.errors, errorCount: mapped.errorCount, skipped: mapped.skipped };
}
