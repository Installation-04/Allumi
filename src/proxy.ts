import { NextResponse, type NextRequest } from "next/server";
import { sessionCookieName } from "@/app/_lib/cookie-name";

// Paths reachable without a session cookie. The real check (database lookup) happens in the pages.
const PUBLIC_PREFIXES = ["/connexion", "/setup", "/api/health"];

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

  const response = NextResponse.next({ request: { headers } });
  response.headers.set("x-request-id", requestId);
  return response;
}

export const config = {
  // Everything except Next internals and static files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|txt|xml)$).*)"],
};
