import { getTranslations } from "@/platform/i18n/server";
import { getClientDocumentEvidence } from "@/modules/contracts";
import { AppError } from "@/platform/errors";
import { loadCompany } from "../../../_lib";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string; documentId: string }> }) {
  const { actor } = await loadCompany(params, "sales.read");
  const { documentId } = await params;
  const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow, noarchive" };
  try {
    const evidence = await getClientDocumentEvidence(actor, documentId);
    if (!evidence) return new Response(null, { status: 404, headers });
    return Response.json(evidence, { headers: { ...headers, "Content-Disposition": `attachment; filename="allumi-evidence-${evidence.publication.id}.json"` } });
  } catch (error) {
    if (!(error instanceof AppError && error.key === "contracts.evidenceIntegrity")) throw error;
    return new Response((await getTranslations("errors"))("contracts.evidenceIntegrity"), { status: 409, headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" } });
  }
}
