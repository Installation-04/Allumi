/** Bounded UTF-8 CSV input. No spreadsheet execution, formula evaluation or format guessing. */
export const MAX_MIGRATION_BYTES = 1024 * 1024;
export const MAX_MIGRATION_ROWS = 1000;
export type Delimiter = "," | ";" | "\t";
export type MigrationIssue = "encoding" | "size" | "syntax" | "columns" | "empty" | "rows" | "mapping" | "invalid" | "duplicate" | "currency" | "inventory";
export class MigrationCsvError extends Error {
  constructor(readonly code: MigrationIssue, readonly row = 0, readonly field = "") { super(code); this.name = "MigrationCsvError"; }
}
export function decodeMigrationCsv(bytes: Uint8Array): string {
  if (bytes.length > MAX_MIGRATION_BYTES) throw new MigrationCsvError("size");
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw new MigrationCsvError("encoding"); }
}
export function readMigrationRecords(input: string, delimiter: Delimiter) {
  if (![",", ";", "\t"].includes(delimiter)) throw new MigrationCsvError("syntax");
  if (new TextEncoder().encode(input).byteLength > MAX_MIGRATION_BYTES) throw new MigrationCsvError("size");
  const text = input.replace(/^\uFEFF/, "");
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)) throw new MigrationCsvError("syntax");
  const records: { row: number; cells: string[] }[] = [];
  let cells: string[] = [], cell = "", mode: "start" | "plain" | "quoted" | "closed" = "start", line = 1, start = 1;
  const endCell = () => { cells.push(cell.trim()); cell = ""; mode = "start"; if (cells.length > 50) throw new MigrationCsvError("columns", start); };
  const endRow = () => { endCell(); if (cells.some(Boolean)) records.push({ row: start, cells }); cells = []; if (records.length > MAX_MIGRATION_ROWS + 20) throw new MigrationCsvError("rows", start); };
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (mode === "quoted") {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else mode = "closed"; }
      else { cell += c; if (c === "\n" || (c === "\r" && text[i + 1] !== "\n")) line++; }
    } else if (c === delimiter) endCell();
    else if (c === "\r" || c === "\n") { if (c === "\r" && text[i + 1] === "\n") i++; endRow(); line++; start = line; }
    else if (mode === "closed") throw new MigrationCsvError("syntax", start);
    else if (c === '"') { if (mode !== "start") throw new MigrationCsvError("syntax", start); mode = "quoted"; }
    else { cell += c; mode = "plain"; }
    if (cell.length > 5000) throw new MigrationCsvError("size", start);
  }
  if (mode === "quoted") throw new MigrationCsvError("syntax", start);
  if (cell || cells.length || mode === "closed") endRow();
  return records;
}
export function readMigrationCsv(input: string, delimiter: Delimiter, headerRecord = 1) {
  if (!Number.isInteger(headerRecord) || headerRecord < 1 || headerRecord > 20) throw new MigrationCsvError("mapping");
  const records = readMigrationRecords(input, delimiter).slice(headerRecord - 1);
  const header = records.shift();
  if (!header || !header.cells.length || header.cells.some(c => c.length > 120) || !header.cells.some(Boolean)) throw new MigrationCsvError("columns", 1);
  if (!records.length) throw new MigrationCsvError("empty");
  if (records.length > MAX_MIGRATION_ROWS) throw new MigrationCsvError("rows");
  for (const r of records) if (r.cells.length !== header.cells.length) throw new MigrationCsvError("columns", r.row);
  return { headers: header.cells, rows: records };
}
