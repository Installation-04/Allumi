import "server-only";
import type { CompanyContext } from "@/platform/tenant";
import { getClientDocumentEvidence } from "./evidence";
import { clientDocumentPrintHtml } from "../domain/print-copy";

export async function getClientDocumentPrintCopy(actor: CompanyContext, id: string) {
  const evidence = await getClientDocumentEvidence(actor, id);
  return evidence ? { id: evidence.publication.id, html: clientDocumentPrintHtml(evidence) } : null;
}
