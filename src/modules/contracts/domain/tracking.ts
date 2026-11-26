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

export const CLIENT_DOCUMENT_EXPORT_LIMIT = 5000;
/** Shared URL parsing for list and complete export; repeated fields are rejected. */
export function clientDocumentQuery(query:Record<string,string|string[]|undefined>){
 const one=(name:string)=>{const v=query[name];if(v!==undefined&&typeof v!=='string')throw new RangeError('document filters');return v??'';};
 const raw=one('q'),pageText=query.page===undefined?'1':one('page');
 if([...raw.trim()].length>120||/[\p{Cc}]/u.test(raw)||! /^[1-9]\d*$/.test(pageText)||!Number.isSafeInteger(Number(pageText))||Number(pageText)>1000)throw new RangeError('document filters');
 const filters=trackingFilters.parse({kind:one('kind'),stage:one('stage'),link:one('link')});return {q:raw.trim(),page:Number(pageText),...filters};
}
