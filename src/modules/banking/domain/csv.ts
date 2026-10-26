import { MAX_STATEMENT_ROWS, StatementError } from "./statement";

export const DELIMITERS = [",", ";", "\t"] as const;
export type Delimiter = (typeof DELIMITERS)[number];

const MAX_COLUMNS = 40;
const MAX_CELL = 1_000;

/** How many delimiters each of the first lines has outside quotes. */
function countsPerLine(text: string, delimiter: Delimiter): number[] {
  const counts: number[] = [];
  let count = 0;
  let quoted = false;
  let empty = true;
  for (let i = 0; i < text.length && counts.length < 30; i++) {
    const char = text[i];
    if (char === '"') quoted = !quoted;
    if (!quoted && char === delimiter) count++;
    if (!quoted && (char === "\n" || char === "\r")) {
      if (!empty) counts.push(count);
      count = 0;
      empty = true;
      continue;
    }
    if (char !== " ") empty = false;
  }
  if (!empty && counts.length < 30) counts.push(count);
  return counts;
}

/** The delimiter that splits the first lines into the same number (at least two) of columns most often. */
export function detectDelimiter(text: string): Delimiter {
  let best: Delimiter = ",";
  let bestScore = 0;
  for (const delimiter of DELIMITERS) {
    const counts = countsPerLine(text, delimiter).filter((count) => count > 0);
    if (counts.length === 0) continue;
    const frequency = new Map<number, number>();
    for (const count of counts) frequency.set(count, (frequency.get(count) ?? 0) + 1);
    const score = Math.max(...frequency.values());
    if (score > bestScore) {
      best = delimiter;
      bestScore = score;
    }
  }
  return best;
}

/**
 * CSV as banks write it (RFC 4180): quoted cells that may hold the delimiter, quotes and line breaks, `""` for a
 * quote, any of CRLF, LF or CR between rows. Entirely empty rows are dropped. A file with too many rows, columns or
 * a cell too long is refused rather than read: it is not a statement.
 */
export function parseCsv(text: string, delimiter: Delimiter = detectDelimiter(text)): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let wasQuoted = false;
  const endCell = () => {
    if (cell.length > MAX_CELL) throw new StatementError("unreadable");
    row.push(wasQuoted ? cell : cell.trim());
    cell = "";
    wasQuoted = false;
    if (row.length > MAX_COLUMNS) throw new StatementError("unreadable");
  };
  const endRow = () => {
    endCell();
    if (row.some((value) => value !== "")) {
      rows.push(row);
      if (rows.length > MAX_STATEMENT_ROWS + 1) throw new StatementError("tooLarge");
    }
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i] as string;
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += char;
      continue;
    }
    if (char === '"' && cell.trim() === "") {
      quoted = true;
      wasQuoted = true;
      cell = "";
    } else if (char === delimiter) endCell();
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      endRow();
    } else cell += char;
  }
  if (quoted) throw new StatementError("unreadable");
  if (cell !== "" || row.length > 0 || wasQuoted) endRow();
  return rows.map((values) => values.map((value) => (value.length > 0 && !/\S/.test(value) ? "" : value)));
}
