import { z } from "zod";
import { isValidIsoDate } from "@/modules/ledger/client";
export const MAX_DEPOSIT_ITEMS = 100;
export const MAX_DEPOSIT_CENTS = 100_000_000_000_000n;
const uuid = z.uuid().transform((value) => value.toLowerCase());
export const depositSchema = z.object({
  paymentIds: z
    .array(uuid)
    .min(1)
    .max(MAX_DEPOSIT_ITEMS)
    .refine((ids) => new Set(ids).size === ids.length),
  accountId: uuid,
  date: z.string().refine(isValidIsoDate),
  expectedTotalCents: z
    .string()
    .regex(/^\d{1,15}$/)
    .transform(BigInt)
    .refine((n) => n > 0n && n <= MAX_DEPOSIT_CENTS),
  reference: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((s) => s || null),
});
export const depositVoidSchema = z.object({
  date: z.string().refine(isValidIsoDate),
  reason: z.string().trim().min(1).max(500),
});
export function depositLines(target: string, source: string, total: bigint) {
  return [
    { accountId: target, debitCents: total, creditCents: 0n },
    { accountId: source, debitCents: 0n, creditCents: total },
  ];
}
