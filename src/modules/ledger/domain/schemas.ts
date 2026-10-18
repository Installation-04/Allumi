import { z } from "zod";
import { isValidIsoDate } from "./dates";
import { MAX_ENTRY_LINES } from "./entry";
import { MAX_LINE_CENTS } from "./money";

export const isoDateSchema = z.string().refine(isValidIsoDate, { message: "date" });

const cents = z.bigint().min(0n).max(MAX_LINE_CENTS);

export const entryLineSchema = z.object({
  accountId: z.uuid(),
  debitCents: cents,
  creditCents: cents,
  description: z.string().trim().max(500).nullish(),
});

/** What a manual entry needs. Balance and line shape are checked by checkEntry, so the user gets a precise reason. */
export const manualEntrySchema = z.object({
  date: isoDateSchema,
  /** MANUAL, or the opening balances entry (the equity side is part of the lines). */
  kind: z.enum(["MANUAL", "OPENING_BALANCE"]).default("MANUAL"),
  memo: z.string().trim().max(500).nullish(),
  lines: z.array(entryLineSchema).max(MAX_ENTRY_LINES),
});

export type ManualEntryInput = z.infer<typeof manualEntrySchema>;

export const reasonSchema = z.string().trim().min(10).max(500);
