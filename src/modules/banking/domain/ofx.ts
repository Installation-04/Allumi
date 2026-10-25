import { guessDecimalSeparator, parseAmount, parseStatementDate } from "./money";
import { cleanText, MAX_DESCRIPTION, MAX_STATEMENT_ROWS, StatementError, type StatementLine } from "./statement";

export type OfxStatement = {
  /** ISO 4217 as the file says (`CURDEF`), upper case. */
  currency: string | null;
  /** The last four digits of the account number, when the file gives one. */
  accountMask: string | null;
  lines: StatementLine[];
  /** The closing balance the bank states, which the reconciliation compares with the books. */
  ledgerBalance: { cents: bigint; date: string } | null;
  /** Transactions that could not be read (no date, no amount, no id); the import refuses a file that has any. */
  errorCount: number;
  /** Transactions of zero, left out. */
  skipped: number;
};

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith("#")) {
      const code = body[1]?.toLowerCase() === "x" ? parseInt(body.slice(2), 16) : Number(body.slice(1));
      return Number.isInteger(code) && code > 31 && code < 0x110000 ? String.fromCodePoint(code) : " ";
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });

/**
 * The value of a leaf tag: OFX 1.x (SGML) has no closing tag on leaves (`<TRNAMT>-12.30`), OFX 2.x (XML) has
 * (`<TRNAMT>-12.30</TRNAMT>`); the text runs to the next `<` or the end of the line.
 */
function leaf(block: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>([^<\\r\\n]*)`, "i").exec(block);
  return match ? decode((match[1] ?? "").trim()) : null;
}

/** OFX dates are `YYYYMMDD[HHMMSS[.XXX]][offset:zone]`: the day is the first eight digits, as written. */
function ofxDate(value: string | null): string | null {
  const digits = /^(\d{8})/.exec((value ?? "").trim())?.[1];
  return digits ? parseStatementDate(digits, "YMD") : null;
}

/**
 * Reads an OFX or QFX statement (bank or credit card), SGML or XML. Amounts follow the file's own convention, which
 * is also the books': money into the account is positive, money out is negative. Each transaction needs a date, an
 * amount and its id (`FITID`); the bank's id is what keeps a transaction from being imported twice.
 */
export function parseOfx(text: string): OfxStatement {
  const start = text.search(/<OFX[\s>]/i);
  if (start < 0) throw new StatementError("unreadable");
  const body = text.slice(start);
  const blocks = [...body.matchAll(/<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi)].map((match) => match[1] ?? "");
  if (blocks.length > MAX_STATEMENT_ROWS) throw new StatementError("tooLarge");
  const result: OfxStatement = { currency: null, accountMask: null, lines: [], ledgerBalance: null, errorCount: 0, skipped: 0 };
  const currency = /^[A-Z]{3}$/.exec((leaf(body, "CURDEF") ?? "").toUpperCase());
  result.currency = currency?.[0] ?? null;
  const account = leaf(body.slice(Math.max(0, body.search(/<(?:BANKACCTFROM|CCACCTFROM)>/i))), "ACCTID");
  const digits = (account ?? "").replace(/\D/g, "");
  result.accountMask = digits.length >= 4 ? digits.slice(-4) : null;
  const balance = /<LEDGERBAL>([\s\S]*?)(?:<\/LEDGERBAL>|<AVAILBAL>|<\/STMTRS>|<\/CCSTMTRS>)/i.exec(body)?.[1];
  if (balance) {
    const raw = leaf(balance, "BALAMT") ?? "";
    const cents = parseAmount(raw, guessDecimalSeparator([raw]));
    const date = ofxDate(leaf(balance, "DTASOF"));
    if (cents !== null && date) result.ledgerBalance = { cents, date };
  }
  const seen = new Set<string>();
  for (const block of blocks) {
    const raw = leaf(block, "TRNAMT") ?? "";
    const cents = parseAmount(raw, guessDecimalSeparator([raw]));
    const date = ofxDate(leaf(block, "DTPOSTED"));
    const fitId = cleanText(leaf(block, "FITID") ?? "", 255);
    if (cents === null || !date || fitId === "") {
      result.errorCount++;
      continue;
    }
    if (cents === 0n) {
      result.skipped++;
      continue;
    }
    const name = cleanText(leaf(block, "NAME") ?? "", MAX_DESCRIPTION);
    const memo = cleanText(leaf(block, "MEMO") ?? "", MAX_DESCRIPTION);
    const description = cleanText([name, memo && memo !== name ? memo : ""].filter(Boolean).join(" · "), MAX_DESCRIPTION) || "—";
    // A bank that repeats an id within one file would make the second line collide with the first: it keeps no id of its own.
    const externalId = seen.has(fitId) ? null : fitId;
    seen.add(fitId);
    result.lines.push({ date, amountCents: cents, description, payee: name || null, externalId });
  }
  return result;
}
