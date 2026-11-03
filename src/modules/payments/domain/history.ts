import { z } from "zod";
import { isValidIsoDate } from "@/modules/ledger/client";

const date = z
  .string()
  .refine((value) => value === "" || isValidIsoDate(value))
  .default("");
/** Empty fields mean an explicit unfiltered history; malformed values never do. */
export const paymentHistorySchema = z
  .object({
    q: z
      .string()
      .regex(/^[^\u0000-\u001f\u007f]*$/)
      .trim()
      .max(120)
      .default(""),
    status: z.enum(["", "POSTED", "VOID"]).default(""),
    from: date,
    to: date,
  })
  .strict()
  .refine((value) => !value.from || !value.to || value.from <= value.to);
export type PaymentHistoryFilters = z.output<typeof paymentHistorySchema>;

/** The immutable customer identity of an invoice/credit, never its internal notes. */
export function billingCustomerName(snapshot: unknown): string {
  if (!snapshot || typeof snapshot !== "object" || !("name" in snapshot))
    return "";
  return typeof snapshot.name === "string" ? snapshot.name : "";
}
