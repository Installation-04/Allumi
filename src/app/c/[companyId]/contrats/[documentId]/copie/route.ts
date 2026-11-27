import { getTranslations } from "@/platform/i18n/server";
import { getClientDocumentPrintCopy, CLIENT_DOCUMENT_COPY_CSP } from "@/modules/contracts";
import { AppError } from "@/platform/errors";
import { loadCompany } from "../../../_lib";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string; documentId: string }> }) {
  const { actor } = await loadCompany(params, "sales.read"), { documentId } = await params;
  const headers = { "Cache-Control": "private, no-store", "Vary": "Cookie", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow, noarchive", "Content-Security-Policy": CLIENT_DOCUMENT_COPY_CSP + "; frame-ancestors 'none'" };
  try {
    const copy = await getClientDocumentPrintCopy(actor, documentId);
    if (!copy) return new Response(null, { status: 404, headers });
    return new Response(copy.html, { headers: { ...headers, "Content-Type": "text/html; charset=utf-8", "Content-Disposition": `attachment; filename="allumi-document-${copy.id}.html"` } });
  } catch (error) {
    if (!(error instanceof AppError && error.key === "contracts.evidenceIntegrity")) throw error;
    return new Response((await getTranslations("errors"))("contracts.evidenceIntegrity"), { status: 409, headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" } });
  }
}
