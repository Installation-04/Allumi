import { receiptSchema } from "./receipt";
import type { z } from "zod";

/** A recorded bank/cash refund, fully applied to an available customer credit. */
export const refundSchema = receiptSchema
  .omit({ invoiceId: true })
  .extend({ creditNoteId: receiptSchema.shape.invoiceId });
export type CustomerRefundInput = z.input<typeof refundSchema>;

/** Refunds leave a real bank or cash account; undeposited funds and cards are excluded. */
export function acceptsRefunds(account: {
  subtype: string;
  isActive: boolean;
}): boolean {
  return account.isActive && ["BANK", "CASH"].includes(account.subtype);
}
