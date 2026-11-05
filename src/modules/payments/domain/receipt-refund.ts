import { z } from "zod";
import { receiptSchema } from "./receipt";

const uuid = z.string().uuid().transform(value => value.toLowerCase());
/** A refund of existing unallocated money, distinct from a refund of a credit note. */
export const receiptRefundSchema = receiptSchema.omit({ invoiceId: true }).extend({
  submissionId: uuid,
  receiptId: uuid,
  accountId: uuid,
  reference: receiptSchema.shape.reference.refine(value => !value?.includes("\u0000")),
  memo: receiptSchema.shape.memo.refine(value => !value?.includes("\u0000")),
}).strict();
export type ReceiptRefundInput = z.input<typeof receiptRefundSchema>;
