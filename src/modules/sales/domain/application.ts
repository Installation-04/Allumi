import { z } from "zod";

const uuid = z.string().uuid();
const cents = z.string().trim().regex(/^\d{1,15}$/).transform(BigInt);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Reviewed balances protect against a second submission or another concurrent settlement. */
export const customerCreditApplicationSchema = z.object({
  creditNoteId: uuid,
  invoiceId: uuid,
  amountCents: cents.refine(value => value > 0n && value <= 100_000_000_000_000n),
  expectedCreditCents: cents,
  expectedInvoiceCents: cents,
  date,
}).strict();
export const customerCreditUnapplicationSchema = z.object({ date }).strict();
export type CustomerCreditApplicationInput = z.input<typeof customerCreditApplicationSchema>;
export type CustomerCreditUnapplicationInput = z.input<typeof customerCreditUnapplicationSchema>;
