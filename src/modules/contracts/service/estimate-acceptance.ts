import "server-only";
import { z } from "zod";
import { acceptEstimateWithin, type EstimateStatus } from "@/modules/sales";
import { requireRole } from "@/modules/companies";
import { recordEvent } from "@/modules/audit";
import { withCompany, type CompanyContext, type Tx } from "@/platform/tenant";
import { AppError, toAppError } from "@/platform/errors";
import type { PublicClientDocument } from "../domain/document";
import { getClientDocumentEvidenceWithin } from "./evidence";

type Source = { id: string; number: string | null; status: EstimateStatus; revision: string; validUntil: string; eligible: boolean };
async function sourceFor(tx: Tx, companyId: string, id: string) {
  const [source] = await tx.$queryRaw<Source[]>`
    SELECT e.id,e.number,e.status,e.updated_at::text AS revision,to_char(e.valid_until,'YYYY-MM-DD') AS "validUntil",
      (e.status='SENT' AND e.valid_until>=(statement_timestamp() AT TIME ZONE 'America/Toronto')::date) AS eligible
    FROM client_document d JOIN sales_estimate e ON e.company_id=d.company_id AND e.id=d.source_estimate_id
    WHERE d.company_id=${companyId}::uuid AND d.id=${id}::uuid AND d.kind='ESTIMATE' AND d.status='PUBLISHED' AND d.signed_at IS NOT NULL`;
  return source ?? null;
}
/** A private review does not open a client link or change either document. */
export async function getSignedEstimateReview(actor: CompanyContext, id: string) {
  if (!z.uuid().safeParse(id).success) return null;
  return withCompany(actor, async tx => {
    await requireRole(tx, "sales.manage");
    const source = await sourceFor(tx, actor.companyId, id);
    if (!source) return null;
    const proof = await getClientDocumentEvidenceWithin(tx, actor.companyId, id);
    if (!proof?.signature || proof.publication.kind !== "ESTIMATE") return null;
    const d = proof.publication;
    // Deliberately omit the canonical payload, raw snapshot, private link and SMTP history from the page DTO.
    const document: PublicClientDocument = { id: d.id, kind: "ESTIMATE", title: d.title, issuer: d.issuer, customer: d.customer, recipient: d.recipient, locale: d.locale, body: d.text, hash: d.sha256, publishedAt: proof.events.publishedAt, expiresAt: proof.events.expiresAt, signedAt: proof.events.signedAt, signerName: proof.signature.name, signerEmail: proof.signature.email, consentText: proof.signature.consent, canSign: false };
    return { source, document };
  });
}

/** Serialize source decisions without locking immutable proof rows or reversing the public document/source lock order. */
export async function acceptSignedEstimate(actor: CompanyContext, id: string, revision: string, hash: string, confirmed: boolean, note = "") {
  if (confirmed !== true) throw new AppError("contracts.confirm");
  if (!z.uuid().safeParse(id).success || typeof revision !== "string" || revision.length > 100 || !/^[0-9a-f]{64}$/.test(hash) || typeof note !== "string" || note.length > 500) throw new AppError("contracts.invalid");
  try {
    return await withCompany(actor, async tx => {
      await requireRole(tx, "sales.manage");
      const source = await sourceFor(tx, actor.companyId, id);
      if (!source) throw new AppError("contracts.unavailable");
      const [locked] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM sales_estimate WHERE company_id=${actor.companyId}::uuid AND id=${source.id}::uuid FOR UPDATE`;
      if (!locked) throw new AppError("contracts.unavailable");
      const proof = await getClientDocumentEvidenceWithin(tx, actor.companyId, id);
      if (!proof?.signature || proof.publication.kind !== "ESTIMATE") throw new AppError("contracts.unavailable");
      if (proof.publication.sha256 !== hash) throw new AppError("contracts.stale");
      await acceptEstimateWithin(tx, actor, source.id, revision, note);
      await recordEvent(tx, { action: "estimate.accept_signed_document", entityType: "sales_estimate", entityId: source.id, data: { clientDocumentId: id, publicationHash: hash } });
      return source.id;
    });
  } catch (error) { throw toAppError(error); }
}
