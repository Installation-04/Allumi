import { z } from "zod";
import { receiptSchema } from "./receipt";

const uuid = z.string().uuid().transform(value => value.toLowerCase());
/** The server binds one submission ID to a form, so retries cannot record money twice. */
export const onAccountReceiptSchema = receiptSchema.omit({ invoiceId: true, expectedOpenCents: true }).extend({
  submissionId: uuid,
  contactId: uuid,
  accountId: uuid,
  reference: receiptSchema.shape.reference.refine(value => !value?.includes("\u0000")),
  memo: receiptSchema.shape.memo.refine(value => !value?.includes("\u0000")),
}).strict();
export type OnAccountReceiptInput = z.input<typeof onAccountReceiptSchema>;
