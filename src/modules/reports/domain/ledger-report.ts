import { isDebitNormal, type AccountType, type Locale } from "@/modules/ledger/client";
import { csvFormatFor, toCsv, type CsvCell } from "./csv";

/** One line of an account in the ledger report: where it comes from and what it moved. */
export type LedgerLine = {
  lineId: string;
  entryId: string;
  entryNumber: bigint;
  /** The number as the journal writes it (`J-00042`). */
  entryLabel: string;
  date: string;
  /** The `journal_source` of the entry: MANUAL, PAYMENT, BANK… */
  sourceType: string;
  memo: string | null;
  description: string | null;
  contactName: string | null;
  debitCents: bigint;
  creditCents: bigint;
  /** The entry reverses another or has been reversed. */
  reversed: boolean;
};

/** A line with the account's balance after it, in the direction its type normally holds. */
export type LedgerRow = LedgerLine & { balanceCents: bigint };

/** What a line adds to the balance of an account of this type: a debit to an asset or an expense, a credit to the others. */
export const lineEffect = (type: AccountType, line: Pick<LedgerLine, "debitCents" | "creditCents">): bigint => (isDebitNormal(type) ? line.debitCents - line.creditCents : line.creditCents - line.debitCents);

/**
 * The lines in the order the ledger keeps them (date, entry number, line number), each with the running balance after
 * it, from an opening balance. Returns the rows and the closing balance. Exact: every figure is in cents.
 */
export function runLedger(type: AccountType, openingCents: bigint, lines: readonly LedgerLine[]): { rows: LedgerRow[]; closingCents: bigint } {
  let balance = openingCents;
  const rows = lines.map((line) => {
    balance += lineEffect(type, line);
    return { ...line, balanceCents: balance };
  });
  return { rows, closingCents: balance };
}

/** One account of a ledger file: its opening balance, its lines with the balance after each, its closing balance. */
export type LedgerAccountReport = {
  account: { code: string; nameFr: string; nameEn: string };
  openingCents: bigint;
  closingCents: bigint;
  rows: LedgerRow[];
};

/** The words of a ledger file, in the language of the person who exports it. */
export type LedgerLabels = {
  code: string;
  account: string;
  date: string;
  entry: string;
  description: string;
  contact: string;
  debit: string;
  credit: string;
  balance: string;
  opening: string;
  closing: string;
};

/**
 * The ledger as a flat CSV file a spreadsheet can filter: one row per line with its account on every row, an opening
 * row and a closing row (with the period's debits and credits) for each account. Balances are in the direction the
 * account's type normally holds.
 */
export function ledgerCsv(ledgers: readonly LedgerAccountReport[], period: { from: string; to: string; contactName?: string }, title: string, labels: LedgerLabels, locale: Locale): string {
  const rows: CsvCell[][] = [
    [title, "", "", "", "", "", "", "", ""],
    [`${period.from} → ${period.to}`, "", "", "", "", "", "", "", ""],
    ...(period.contactName ? [[labels.contact,period.contactName,"","","","","","",""]] : []),
    [labels.code, labels.account, labels.date, labels.entry, labels.description, labels.contact, labels.debit, labels.credit, labels.balance],
  ];
  for (const ledger of ledgers) {
    const [code, name] = [ledger.account.code, locale === "en" ? ledger.account.nameEn : ledger.account.nameFr];
    rows.push([code, name, period.from, "", labels.opening, "", "", "", ledger.openingCents]);
    for (const line of ledger.rows) rows.push([code, name, line.date, line.entryLabel, line.memo || line.description || "", line.contactName ?? "", line.debitCents, line.creditCents, line.balanceCents]);
    rows.push([code, name, period.to, "", labels.closing, "", ledger.rows.reduce((sum, line) => sum + line.debitCents, 0n), ledger.rows.reduce((sum, line) => sum + line.creditCents, 0n), ledger.closingCents]);
  }
  return toCsv(rows, csvFormatFor(locale));
}
