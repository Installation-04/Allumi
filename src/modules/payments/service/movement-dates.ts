import "server-only";
import { AppError } from "@/platform/errors";
import type { Tx } from "@/platform/tenant";

/** Call after locking the document: current availability cannot be consumed or released retroactively. */
export async function assertCustomerMovementDate(tx: Tx, companyId: string, documentId: string, date: string, errorKey: string): Promise<void> {
  const rows = await tx.$queryRaw<{ latest: Date | null }[]>`
    SELECT max(d) AS latest FROM (
      SELECT posting_date AS d FROM sales_document WHERE company_id=${companyId}::uuid AND id=${documentId}::uuid
      UNION ALL SELECT applied_date FROM payment_allocation WHERE company_id=${companyId}::uuid AND sales_document_id=${documentId}::uuid
      UNION ALL SELECT unapplied_date FROM payment_allocation WHERE company_id=${companyId}::uuid AND sales_document_id=${documentId}::uuid
      UNION ALL SELECT applied_date FROM sales_credit_application WHERE company_id=${companyId}::uuid AND (credit_note_id=${documentId}::uuid OR invoice_id=${documentId}::uuid)
      UNION ALL SELECT unapplied_date FROM sales_credit_application WHERE company_id=${companyId}::uuid AND (credit_note_id=${documentId}::uuid OR invoice_id=${documentId}::uuid)
    ) history`;
  if (rows[0]?.latest && date < rows[0].latest.toISOString().slice(0, 10)) throw new AppError(errorKey);
}
