import "server-only";
import { type Tx } from "@/platform/tenant";
import { documentStage, type TrackingFilters, type DOCUMENT_KINDS, type LINK_STATES } from "../domain/tracking";

export type TrackingRow = { id: string; kind: typeof DOCUMENT_KINDS[number]; title: string; customerName: string; status: string; firstViewedAt: Date | null; signedAt: Date | null; revokedAt: Date | null; expiresAt: Date | null; publishedAt: Date | null; createdAt: Date; capturedAt: Date; linkState: typeof LINK_STATES[number] };
/** One snapshot: filter the complete result before the bounded page, never select link secrets. */
export async function trackingRows(tx: Tx, companyId: string, q: string, filters: TrackingFilters, take: number, skip: number, sourceId: string | null = null, sourceKind: string | null = null) {
  const rows = await tx.$queryRaw<TrackingRow[]>`
    WITH tracked AS (
      SELECT d.id, d.kind, d.title, d.customer_name AS "customerName", d.status,
        d.first_viewed_at AS "firstViewedAt", d.signed_at AS "signedAt", d.revoked_at AS "revokedAt",
        d.expires_at AS "expiresAt", d.published_at AS "publishedAt", d.created_at AS "createdAt", statement_timestamp() AS "capturedAt",
        CASE WHEN d.status='DRAFT' THEN 'DRAFT' WHEN d.signed_at IS NOT NULL THEN 'SIGNED'
          WHEN d.first_viewed_at IS NOT NULL THEN 'VIEWED' ELSE 'PUBLISHED' END AS stage,
        CASE WHEN d.status='DRAFT' THEN 'DRAFT' WHEN d.revoked_at IS NOT NULL THEN 'REVOKED'
          WHEN d.expires_at IS NULL OR d.expires_at<=statement_timestamp() THEN 'EXPIRED'
          WHEN d.kind='ESTIMATE' AND (e.id IS NULL OR e.status NOT IN ('SENT','ACCEPTED','CONVERTED'))
            OR d.kind='INVOICE' AND (i.id IS NULL OR i.status<>'POSTED') THEN 'SOURCE_UNAVAILABLE'
          ELSE 'AVAILABLE' END AS "linkState"
      FROM client_document d
      LEFT JOIN sales_estimate e ON e.company_id=d.company_id AND e.id=d.source_estimate_id
      LEFT JOIN sales_document i ON i.company_id=d.company_id AND i.id=d.source_invoice_id
      WHERE d.company_id=${companyId}::uuid
        AND (${q}='' OR strpos(lower(d.title),lower(${q}))>0 OR strpos(lower(d.customer_name),lower(${q}))>0)
        AND (${filters.kind ?? ''}='' OR d.kind=${filters.kind ?? ''})
        AND (${sourceId}::uuid IS NULL OR ${sourceKind}='ESTIMATE' AND d.source_estimate_id=${sourceId}::uuid OR ${sourceKind}='INVOICE' AND d.source_invoice_id=${sourceId}::uuid)
    ) SELECT * FROM tracked WHERE (${filters.stage ?? ''}='' OR stage=${filters.stage ?? ''})
      AND (${filters.link ?? ''}='' OR "linkState"=${filters.link ?? ''})
    ORDER BY "createdAt" DESC,id DESC LIMIT ${take} OFFSET ${skip}`;
  return rows.map(d => ({ ...d, stage: documentStage(d) }));
}
