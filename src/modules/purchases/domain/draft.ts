import { z } from "zod";
import { isValidIsoDate } from "@/modules/ledger/client";
import { decimalUnits } from "@/modules/taxes/client";
const date = z.string().refine(isValidIsoDate);
const decimal = (places: number, positive: boolean) => z.string().trim().transform(v => v.replace(",", ".")).refine(v => new RegExp(`^\\d{1,12}(?:\\.\\d{1,${places}})?$`).test(v) && (positive ? decimalUnits(v) > 0n : decimalUnits(v) >= 0n));
export const draftLineSchema = z.object({ itemId: z.union([z.uuid(), z.literal("")]).default(""), description: z.string().trim().min(1).max(500), quantity: decimal(4, true), unitPrice: decimal(6, false), accountId: z.uuid(), taxCodeId: z.uuid() });
export const draftSchema = z.object({ contactId: z.uuid(), documentDate: date, dueDate: date, supplierReference: z.string().trim().max(100).default(""), memo: z.string().trim().max(2000).default(""), revision: z.string().max(100).default(""), lines: z.array(draftLineSchema).min(1).max(50) }).refine(v => v.dueDate >= v.documentDate);
export type DraftLineInput = z.input<typeof draftLineSchema>;
