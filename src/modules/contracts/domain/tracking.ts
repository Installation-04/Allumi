import { z } from "zod";

export const DOCUMENT_KINDS = ["CONTRACT", "ESTIMATE", "INVOICE"] as const;
export const DOCUMENT_STAGES = ["DRAFT", "PUBLISHED", "VIEWED", "SIGNED"] as const;
export const LINK_STATES = ["DRAFT", "AVAILABLE", "EXPIRED", "REVOKED", "SOURCE_UNAVAILABLE"] as const;
export const trackingFilters = z.object({
  kind: z.enum(["", ...DOCUMENT_KINDS]).default(""),
  stage: z.enum(["", ...DOCUMENT_STAGES]).default(""),
  link: z.enum(["", ...LINK_STATES]).default(""),
});
export type TrackingFilters = z.input<typeof trackingFilters>;
export function documentStage(d: { status: string; signedAt: Date | null; firstViewedAt: Date | null }): typeof DOCUMENT_STAGES[number] {
  return d.status === "DRAFT" ? "DRAFT" : d.signedAt ? "SIGNED" : d.firstViewedAt ? "VIEWED" : "PUBLISHED";
}
export function documentLinkState(d: { status: string; revokedAt: Date | null; expiresAt: Date | null }, sourceAvailable: boolean, now = new Date()): typeof LINK_STATES[number] {
  if (d.status === "DRAFT") return "DRAFT";
  if (d.revokedAt) return "REVOKED";
  if (!d.expiresAt || d.expiresAt <= now) return "EXPIRED";
  return sourceAvailable ? "AVAILABLE" : "SOURCE_UNAVAILABLE";
}
