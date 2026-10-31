import { receiptSchema } from "./receipt";
export { receiptVoidSchema } from "./receipt";
export const disbursementSchema = receiptSchema.omit({ invoiceId: true }).extend({ billId: receiptSchema.shape.invoiceId });
export function acceptsDisbursements(account: { subtype: string; isActive: boolean }): boolean {
  return account.isActive && ["BANK", "CASH", "CREDIT_CARD"].includes(account.subtype);
}
