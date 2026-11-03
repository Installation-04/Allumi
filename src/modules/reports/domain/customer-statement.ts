/** Customer-facing accounting activity: descriptions are translated by kind, never journal memos. */
export type CustomerStatementKind =
  | "INVOICE"
  | "CREDIT_NOTE"
  | "RECEIPT"
  | "REFUND"
  | "REVERSAL"
  | "ADJUSTMENT";
export type CustomerStatementRow = {
  id: string;
  entryId: string;
  entryNumber: string;
  date: string;
  kind: CustomerStatementKind;
  sourceId: string | null;
  sourceNumber: string | null;
  debitCents: bigint;
  creditCents: bigint;
  balanceCents: bigint;
};
export type CustomerStatement = {
  contact: {
    id: string;
    displayName: string;
    legalName: string | null;
    isActive: boolean;
  };
  from: string;
  to: string;
  openingCents: bigint;
  debitCents: bigint;
  creditCents: bigint;
  closingCents: bigint;
  rows: CustomerStatementRow[];
  lineCount: number;
  page: number;
  pageCount: number;
};
/** A receivable debit increases what the customer owes; credits and receipts reduce it. */
export function customerStatementBalance(
  openingCents: bigint,
  debitCents: bigint,
  creditCents: bigint,
): bigint {
  return openingCents + debitCents - creditCents;
}
