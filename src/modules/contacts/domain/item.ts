import { z } from "zod";
import { optionalText } from "@/modules/companies/client";

// 10^13 in micro-dollars is ten million dollars a unit: far above any real price, below what numeric(19, 6) holds.
const MAX_UNIT_PRICE = 10_000_000_000_000n;

/** A product or a service that can be put on a document line: its default price, accounts and tax code. */
export const itemInputSchema = z.object({
  code: optionalText(40),
  name: z.string().trim().min(1).max(120),
  description: optionalText(500),
  /** Micro-dollars (six decimals), or none. Negative is allowed (a discount item). */
  unitPrice: z.bigint().min(-MAX_UNIT_PRICE).max(MAX_UNIT_PRICE).nullish().transform((value) => value ?? null),
  incomeAccountId: z.uuid().nullish().transform((value) => value ?? null),
  expenseAccountId: z.uuid().nullish().transform((value) => value ?? null),
  defaultTaxCodeId: z.uuid().nullish().transform((value) => value ?? null),
});

export type ItemInput = z.input<typeof itemInputSchema>;
export type ItemData = z.output<typeof itemInputSchema>;
