import type { StatementLine } from "./statement";

/** The accent marks left over once letters are decomposed (a letter with an accent becomes the letter and a mark). */
const COMBINING_MARKS = new RegExp("[\\u0300-\\u036f]", "g");

/** The description as a person would compare two lines: case, accents and spacing do not matter. */
export function normalizeDescription(text: string): string {
  return text.normalize("NFKD").replace(COMBINING_MARKS, "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 100);
}

export type KeyedLine = StatementLine & {
  /** Unique per account (the database keeps it so): importing the same line again is a no-op. */
  dedupeKey: string;
};

/**
 * The key of each line. With a bank id (OFX) it is that id. Without one (CSV) it is the date, the amount and the
 * description, plus the rank among identical lines of the same file: two identical purchases on one day are two
 * lines, and a later statement that overlaps this one gives the same keys to the same lines.
 */
export function keyLines(lines: StatementLine[]): KeyedLine[] {
  const ranks = new Map<string, number>();
  return lines.map((line) => {
    if (line.externalId !== null) return { ...line, dedupeKey: `ofx:${line.externalId}` };
    const base = `${line.date}|${line.amountCents}|${normalizeDescription(line.description)}`;
    const rank = (ranks.get(base) ?? 0) + 1;
    ranks.set(base, rank);
    // A line without an id keeps a key of its own even when its id was a repeat within the file.
    return { ...line, dedupeKey: `csv:${base}|${rank}` };
  });
}
