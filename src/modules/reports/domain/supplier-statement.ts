/** Supplier-facing accounting activity: descriptions are translated by kind, never journal memos. */
export type SupplierStatementKind =
  | "BILL"
  | "SUPPLIER_CREDIT"
  | "PAYMENT"
  | "REFUND"
  | "REVERSAL"
  | "ADJUSTMENT";
export type SupplierStatementRow = {
  id: string;
  entryId: string;
  entryNumber: string;
  date: string;
  kind: SupplierStatementKind;
  sourceId: string | null;
  sourceNumber: string | null;
  supplierReference: string | null;
  debitCents: bigint;
  creditCents: bigint;
  balanceCents: bigint;
};
export type SupplierStatement = {
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
  rows: SupplierStatementRow[];
  lineCount: number;
  page: number;
  pageCount: number;
};
/** A payable credit increases what is owed to the supplier; debits and payments reduce it. */
export function supplierStatementBalance(
  openingCents: bigint,
  debitCents: bigint,
  creditCents: bigint,
): bigint {
  return openingCents + creditCents - debitCents;
}
