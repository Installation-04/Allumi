import { z } from "zod";

const uuid = z.string().uuid();
const cents = z.string().trim().regex(/^\d{1,15}$/).transform(BigInt);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Reviewed balances protect against a second submission or another concurrent settlement. */
export const supplierCreditApplicationSchema = z.object({
  supplierCreditId: uuid,
  billId: uuid,
  amountCents: cents.refine(value => value > 0n && value <= 100_000_000_000_000n),
  expectedCreditCents: cents,
  expectedBillCents: cents,
  date,
}).strict();
export const supplierCreditUnapplicationSchema = z.object({ date }).strict();
export type SupplierCreditApplicationInput = z.input<typeof supplierCreditApplicationSchema>;
export type SupplierCreditUnapplicationInput = z.input<typeof supplierCreditUnapplicationSchema>;
