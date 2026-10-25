import "server-only";
import { formatNumber } from "@/modules/ledger";
import type { Tx } from "@/platform/tenant";
import { SUGGESTION_DAYS } from "../domain/matching";

/** A ledger line on the statement's account, as the person sees it: its entry, and what it moves on this account. */
export type LedgerLineDto = {
  lineId: string;
  entryId: string;
  entryNumber: bigint;
  /** The number as the journal shows it (`J-00042`). */
  entryLabel: string;
  entryDate: string;
  /** The `journal_source` of the entry: MANUAL, PAYMENT, BANK… */
  sourceType: string;
  memo: string | null;
  description: string | null;
  contactName: string | null;
  /** Debit − credit on the account: positive when money comes in. */
  cents: bigint;
  /** The entry was cancelled by a reversal, or is one. */
  reversed: boolean;
  /** A completed reconciliation has counted the line. */
  reconciled: boolean;
};

export type MatchedLineDto = LedgerLineDto;

const iso = (date: Date): string => date.toISOString().slice(0, 10);

type LineRow = {
  id: string; debitCents: bigint; creditCents: bigint; description: string | null; entryDate: Date;
  entry: { id: string; entryNumber: bigint; sourceType: string; memo: string | null; reversesEntryId: string | null; reversedBy: { id: string } | null };
  contact: { displayName: string } | null;
  reconciledLine: { reconciliation: { status: string } } | null;
};

export const lineSelect = {
  id: true, debitCents: true, creditCents: true, description: true, entryDate: true,
  entry: { select: { id: true, entryNumber: true, sourceType: true, memo: true, reversesEntryId: true, reversedBy: { select: { id: true } } } },
  contact: { select: { displayName: true } },
  reconciledLine: { select: { reconciliation: { select: { status: true } } } },
} as const;

type NumberFormat = { prefix: string; padding: number };

/** How this company writes its entry numbers. */
export async function entryNumberFormat(tx: Tx, companyId: string): Promise<NumberFormat> {
  const sequence = await tx.numberSequence.findUnique({ where: { companyId_key: { companyId, key: "JOURNAL_ENTRY" } }, select: { prefix: true, padding: true } });
  return sequence ?? { prefix: "", padding: 0 };
}

export function toLineDto(row: LineRow, format: NumberFormat): LedgerLineDto {
  return {
    lineId: row.id, entryId: row.entry.id, entryNumber: row.entry.entryNumber, entryLabel: formatNumber(format.prefix, format.padding, row.entry.entryNumber), entryDate: iso(row.entryDate), sourceType: row.entry.sourceType, memo: row.entry.memo,
    description: row.description, contactName: row.contact?.displayName ?? null, cents: row.debitCents - row.creditCents,
    reversed: row.entry.reversesEntryId !== null || row.entry.reversedBy !== null,
    reconciled: row.reconciledLine?.reconciliation.status === "COMPLETED",
  };
}

/** The ledger lines each transaction is matched to. */
export async function loadMatches(tx: Tx, companyId: string, transactionIds: string[]): Promise<Map<string, MatchedLineDto[]>> {
  const result = new Map<string, MatchedLineDto[]>();
  if (transactionIds.length === 0) return result;
  const format = await entryNumberFormat(tx, companyId);
  const rows = await tx.bankMatch.findMany({
    where: { companyId, bankTransactionId: { in: transactionIds } },
    select: { bankTransactionId: true, journalLine: { select: lineSelect } },
    orderBy: [{ journalLine: { entryDate: "asc" } }, { journalLine: { entryId: "asc" } }, { journalLine: { lineNo: "asc" } }],
  });
  for (const row of rows) {
    const list = result.get(row.bankTransactionId) ?? [];
    list.push(toLineDto(row.journalLine, format));
    result.set(row.bankTransactionId, list);
  }
  return result;
}

/**
 * For each unmatched transaction, the one ledger line that most likely is it: same account, exactly the same amount,
 * within a week of the date, not yet matched and not part of a reversal. The closest date wins. One
 * query for the whole page.
 */
export async function loadSuggestions(tx: Tx, companyId: string, transactionIds: string[]): Promise<Map<string, LedgerLineDto>> {
  const result = new Map<string, LedgerLineDto>();
  if (transactionIds.length === 0) return result;
  const rows = await tx.$queryRaw<{ transaction_id: string; line_id: string }[]>`
    SELECT t.id AS transaction_id, s.id AS line_id
      FROM bank_transaction t
      CROSS JOIN LATERAL (
        SELECT l.id
          FROM journal_line l
          JOIN journal_entry e ON e.company_id = l.company_id AND e.id = l.entry_id
         WHERE l.company_id = t.company_id AND l.account_id = t.account_id
           AND l.debit_cents - l.credit_cents = t.amount_cents
           AND l.entry_date BETWEEN t.txn_date - ${SUGGESTION_DAYS}::int AND t.txn_date + ${SUGGESTION_DAYS}::int
           AND e.reverses_entry_id IS NULL
           AND NOT EXISTS (SELECT 1 FROM journal_entry r WHERE r.company_id = e.company_id AND r.reverses_entry_id = e.id)
           AND NOT EXISTS (SELECT 1 FROM bank_match m WHERE m.company_id = l.company_id AND m.journal_line_id = l.id)
         ORDER BY abs(l.entry_date - t.txn_date), e.entry_number, l.line_no
         LIMIT 1
      ) s
     WHERE t.company_id = ${companyId}::uuid AND t.status = 'UNMATCHED' AND t.id = ANY(${transactionIds}::uuid[])`;
  if (rows.length === 0) return result;
  const lines = await tx.journalLine.findMany({ where: { companyId, id: { in: rows.map((row) => row.line_id) } }, select: lineSelect });
  const format = await entryNumberFormat(tx, companyId);
  const byId = new Map(lines.map((line) => [line.id, toLineDto(line, format)]));
  for (const row of rows) {
    const line = byId.get(row.line_id);
    if (line) result.set(row.transaction_id, line);
  }
  return result;
}
