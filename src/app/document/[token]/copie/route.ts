import { clientIp } from "@/app/_lib/session";
import { getPublicSignedDocumentCopy, CLIENT_DOCUMENT_COPY_CSP } from "@/modules/contracts";
import { AppError } from "@/platform/errors";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow, noarchive", "Content-Security-Policy": CLIENT_DOCUMENT_COPY_CSP + "; frame-ancestors 'none'" };
  try {
    const copy = await getPublicSignedDocumentCopy((await params).token, await clientIp());
    if (!copy) return new Response("Document indisponible / Document unavailable.", { status: 404, headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" } });
    return new Response(copy.html, { headers: { ...headers, "Content-Type": "text/html; charset=utf-8", "Content-Disposition": `attachment; filename="allumi-document-${copy.id}.html"` } });
  } catch (error) {
    if (!(error instanceof AppError && error.key === "contracts.rateLimit")) throw error;
    return new Response("Trop de demandes / Too many requests.", { status: 429, headers: { ...headers, "Retry-After": "900", "Content-Type": "text/plain; charset=utf-8" } });
  }
}
