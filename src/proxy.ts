import { NextResponse, type NextRequest } from "next/server";
import { sessionCookieName } from "@/app/_lib/cookie-name";
import { contentSecurityPolicy, newNonce } from "@/platform/csp";

// Paths reachable without a session cookie. The real check (database lookup) happens in the pages.
const PUBLIC_PREFIXES = ["/connexion", "/setup", "/api/health", "/manifest.webmanifest"];

export function proxy(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const headers = new Headers(request.headers);
  headers.set("x-request-id", requestId);

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  if (!isPublic && !request.cookies.has(sessionCookieName())) {
    const redirect = NextResponse.redirect(new URL("/connexion", request.url));
    redirect.headers.set("x-request-id", requestId);
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
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export const config = {
  // Everything except Next internals and static files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|txt|xml)$).*)"],
};
