import { NextResponse, type NextRequest } from "next/server";
import { sessionCookieName } from "@/app/_lib/cookie-name";
import { contentSecurityPolicy, newNonce } from "@/platform/csp";
import { CLIENT_DOCUMENT_COPY_CSP } from "@/modules/contracts/client";

// Paths reachable without a session cookie. The real check (database lookup) happens in the pages.
const PUBLIC_PREFIXES = ["/document", "/invitation", "/connexion", "/setup", "/api/health", "/manifest.webmanifest"];

export function proxy(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const headers = new Headers(request.headers);
  headers.set("x-request-id", requestId);

  const { pathname } = request.nextUrl;
  const isPrivateDocumentExport = /^\/c\/[^/]+\/contrats\/[^/]+\/(?:copie|preuve)\/?$/.test(pathname);
  const isPublic = PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  if (!isPublic && !request.cookies.has(sessionCookieName())) {
    // The suggestion endpoint returns JSON even before sign-in; it still performs full session/MFA checks.
    if (/^\/c\/[^/]+\/recherche\/suggestions\/?$/.test(pathname)) {
      const denied = NextResponse.json({ error: "unauthorized" }, { status: 401, headers: {
        "Cache-Control": "private, no-store", "Vary": "Cookie", "Cross-Origin-Resource-Policy": "same-origin", "X-Content-Type-Options": "nosniff",
      } });
      denied.headers.set("x-request-id", requestId);
      return denied;
    }
    const redirect = NextResponse.redirect(new URL("/connexion", request.url));
    redirect.headers.set("x-request-id", requestId);
    if (isPrivateDocumentExport) {
      redirect.headers.set("Referrer-Policy", "no-referrer");
      redirect.headers.set("Cache-Control", "private, no-store");
      redirect.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
    }
    return redirect;
  }

  // Strict policy for this response. Next stamps the nonce on its own scripts and styles by reading it from the
  // Content-Security-Policy header of the request it renders (see node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md).
  const nonce = newNonce();
  const policy = contentSecurityPolicy(nonce, { development: process.env.NODE_ENV === "development" });
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", policy);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set("x-request-id", requestId);
  const isDocumentCopy = /^\/c\/[^/]+\/contrats\/[^/]+\/copie\/?$/.test(pathname) || /^\/document\/[^/]+\/copie\/?$/.test(pathname);
  // Proxy response headers take precedence over route headers in Next. Preserve the self-contained file policy.
  response.headers.set("Content-Security-Policy", isDocumentCopy ? CLIENT_DOCUMENT_COPY_CSP + "; frame-ancestors 'none'" : policy);
  if(isPrivateDocumentExport||pathname==="/document"||pathname.startsWith("/document/")){response.headers.set("Referrer-Policy","no-referrer");response.headers.set("X-Robots-Tag","noindex, nofollow, noarchive");response.headers.set("Cache-Control","private, no-store");}
  return response;
}

export const config = {
  // Everything except Next internals and static files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|txt|xml)$).*)"],
};
