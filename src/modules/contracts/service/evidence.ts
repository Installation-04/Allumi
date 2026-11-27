import "server-only";
import { z } from "zod";
import { requireRole } from "@/modules/companies";
import { sha256Hex } from "@/modules/auth";
import { withCompany, type CompanyContext, type Tx } from "@/platform/tenant";
import { AppError } from "@/platform/errors";
import { sourceDocumentText } from "../domain/source";

type EvidenceRow = {
  id: string; companyId: string; kind: "CONTRACT" | "ESTIMATE" | "INVOICE";
  title: string; issuer: string; customer: string; recipient: string; locale: "fr-CA" | "en";
  renderedBody: string; sourceSnapshot: unknown; hash: string; canonicalPayload: string;
  publishedAt: Date; expiresAt: Date; firstViewedAt: Date | null; signedAt: Date | null;
  revokedAt: Date | null; signerName: string | null; signerEmail: string | null;
  consentText: string | null; capturedAt: Date;
};

/** Read one publication/proof snapshot without decrypting a link or recording a client view. */
export async function getClientDocumentEvidence(actor: CompanyContext, id: string) {
  if (!z.uuid().safeParse(id).success) return null;
  return withCompany(actor, tx => getClientDocumentEvidenceWithin(tx, actor.companyId, id));
}

/** Reuse the same verified proof inside a caller-owned company transaction. */
export async function getClientDocumentEvidenceWithin(tx: Tx, companyId: string, id: string) {
    await requireRole(tx, "sales.read");
    const [d] = await tx.$queryRaw<EvidenceRow[]>`
      SELECT id, company_id AS "companyId", kind, title, issuer_name AS issuer,
        customer_name AS customer, customer_email AS recipient, locale,
        rendered_body AS "renderedBody", source_snapshot AS "sourceSnapshot", content_hash AS hash,
        jsonb_build_array(id, company_id, kind, title, issuer_name, customer_name,
          customer_email, locale, hourly_rate_cents, rendered_body, source_snapshot)::text AS "canonicalPayload",
        published_at AS "publishedAt", expires_at AS "expiresAt", first_viewed_at AS "firstViewedAt",
        signed_at AS "signedAt", revoked_at AS "revokedAt", signer_name AS "signerName",
        signer_email AS "signerEmail", consent_text AS "consentText", statement_timestamp() AS "capturedAt"
      FROM client_document WHERE company_id=${companyId}::uuid AND id=${id}::uuid AND status='PUBLISHED'`;
    if (!d) return null;
    if (sha256Hex(d.canonicalPayload) !== d.hash) throw new AppError("contracts.evidenceIntegrity");
    return {
      format: "allumi.client-document-evidence", version: 1,
      capturedAt: d.capturedAt.toISOString(),
      publication: {
        id: d.id, companyId: d.companyId, kind: d.kind, title: d.title, issuer: d.issuer,
        customer: d.customer, recipient: d.recipient, locale: d.locale,
        text: d.kind === "CONTRACT" ? d.renderedBody : sourceDocumentText(d.sourceSnapshot, d.locale),
        sha256: d.hash, canonicalization: "postgresql-jsonb-array-text-v1",
        canonicalFields: ["id", "companyId", "kind", "title", "issuer", "customer", "recipient", "locale", "hourlyRateCents", "renderedBody", "sourceSnapshot"],
        canonicalPayload: d.canonicalPayload,
      },
      events: {
        publishedAt: d.publishedAt.toISOString(), expiresAt: d.expiresAt.toISOString(),
        firstViewedAt: d.firstViewedAt?.toISOString() ?? null,
        signedAt: d.signedAt?.toISOString() ?? null, revokedAt: d.revokedAt?.toISOString() ?? null,
      },
      signature: d.signedAt ? { name: d.signerName, email: d.signerEmail, consent: d.consentText } : null,
      limitations: {
        identityVerified: false, externalTimestamp: false, digitallySealedFile: false,
        hashScope: "publication.canonicalPayload UTF-8 bytes only; excludes events, signature and the export file",
      },
    };
}
