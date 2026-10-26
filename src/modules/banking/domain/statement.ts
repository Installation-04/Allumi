/** What a statement line is once read, whatever the file format: the shape the rest of the module works with. */
export type StatementLine = {
  /** The posting date as written in the file, YYYY-MM-DD (no time zone is applied). */
  date: string;
  /** The effect on the ledger account: positive is money in (a debit), negative is money out. Never zero. */
  amountCents: bigint;
  description: string;
  payee: string | null;
  /** The bank's own transaction id (OFX FITID) when the file has one. */
  externalId: string | null;
};

/** Why a statement cannot be read. The service turns each code into a message under `errors.banking`. */
export type StatementErrorCode = "empty" | "tooLarge" | "unreadable" | "noTransactions" | "mapping" | "currency";

export class StatementError extends Error {
  constructor(readonly code: StatementErrorCode) {
    super(code);
    this.name = "StatementError";
  }
}

/** A file larger than this is not a statement. */
export const MAX_STATEMENT_BYTES = 4 * 1024 * 1024;
export const MAX_STATEMENT_ROWS = 20_000;
export const MAX_DESCRIPTION = 200;

/** A text kept to a length, with no control characters: it ends up on screen and in the audit trail. */
export function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const text = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * The bytes of a statement as text. Banks send UTF-8 (with or without a byte-order mark) or Windows-1252 (accents
 * written as single bytes): a file that is not valid UTF-8 is read as Windows-1252, which never fails.
 */
export function decodeStatement(bytes: Uint8Array): string {
  if (bytes.byteLength === 0) throw new StatementError("empty");
  if (bytes.byteLength > MAX_STATEMENT_BYTES) throw new StatementError("tooLarge");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder("windows-1252").decode(bytes);
  }
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** OFX files start with a header or the <OFX> tag; anything else is read as CSV. */
export function detectFormat(text: string): "OFX" | "CSV" {
  const head = text.trimStart().slice(0, 2000);
  return /^OFXHEADER\s*:/i.test(head) || /<OFX[\s>]/i.test(head) ? "OFX" : "CSV";
}
