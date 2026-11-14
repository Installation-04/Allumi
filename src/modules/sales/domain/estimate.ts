import { z } from "zod";
import { draftSchema } from "./draft";
export const ESTIMATE_STATUSES = ["DRAFT", "SENT", "ACCEPTED", "DECLINED", "CANCELLED", "CONVERTED"] as const;
export type EstimateStatus = typeof ESTIMATE_STATUSES[number];
export const estimateSchema = draftSchema.safeExtend({ terms: z.string().trim().max(4000).default("") });
export function estimateTransitionAllowed(from: string, to: string, validUntil: string, today: string) {
  if (from === "DRAFT" && to === "SENT") return validUntil >= today;
  if (from === "SENT" && to === "ACCEPTED") return validUntil >= today;
  if (from === "SENT" && to === "DECLINED") return true;
  return ["DRAFT", "SENT", "ACCEPTED"].includes(from) && to === "CANCELLED";
}
export const snapshotSchema = z.object({ name: z.string(), legalName: z.string().nullable().optional(), addressLine1: z.string().nullable().optional(), addressLine2: z.string().nullable().optional(), city: z.string().nullable().optional(), province: z.string().nullable().optional(), postalCode: z.string().nullable().optional(), country: z.string().nullable().optional(), email: z.string().nullable().optional(), phone: z.string().nullable().optional(), gstNumber: z.string().nullable().optional(), qstNumber: z.string().nullable().optional() });
export const estimateTaxSchema = z.array(z.object({ id: z.uuid(), code: z.string(), rate: z.string(), baseCents: z.string().regex(/^\d+$/), amountCents: z.string().regex(/^\d+$/) }));
