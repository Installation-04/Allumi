import { z } from "zod";
import { receiptSchema } from "./receipt";

const uuid = z.string().uuid().transform(value => value.toLowerCase());
export const receiptAllocationSchema = z.object({
  paymentId: uuid,
  invoiceId: uuid,
  amountCents: receiptSchema.shape.amountCents,
  expectedPaymentCents: receiptSchema.shape.expectedOpenCents,
  expectedInvoiceCents: receiptSchema.shape.expectedOpenCents,
  date: receiptSchema.shape.date,
}).strict();
export const receiptUnallocationSchema = z.object({ date: receiptSchema.shape.date }).strict();
export type ReceiptAllocationInput = z.input<typeof receiptAllocationSchema>;
export type ReceiptUnallocationInput = z.input<typeof receiptUnallocationSchema>;
