import { receiptSchema } from "./receipt";
import type { z } from "zod";

/** Money received against an available supplier credit, not a second purchase-tax adjustment. */
export const supplierRefundSchema = receiptSchema.omit({ invoiceId: true }).extend({ supplierCreditId: receiptSchema.shape.invoiceId }).strict();
export type SupplierRefundInput = z.input<typeof supplierRefundSchema>;
export function acceptsSupplierRefunds(account: { subtype: string; isActive: boolean }): boolean {
  return account.isActive && ["BANK", "CASH", "CREDIT_CARD"].includes(account.subtype);
}
