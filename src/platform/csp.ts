/**
 * Content-Security-Policy of the HTML pages. Scripts and styles run only with the nonce of the request (fresh for
 * every response, set by src/proxy.ts), and `strict-dynamic` lets those scripts load their own chunks, so an HTML
 * injection cannot run code. No `unsafe-inline` for scripts, ever.
 *
 * Deliberately absent: `upgrade-insecure-requests`. Allumi is served over plain HTTP by design (direct access on a
 * private network, TLS only through an optional external proxy); that directive would make the browser ask for every
 * script and image over https and break the page.
 */

/** 128 random bits, base64: unpredictable and unique per request. Runtime-agnostic (no Buffer). */
export function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

export function contentSecurityPolicy(nonce: string, options: { development?: boolean } = {}): string {
  const development = options.development ?? false;
  const directives = [
    "default-src 'self'",
    // React rebuilds server stack traces with eval in development only; production never needs it.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'`,
    // Inline style *attributes* are not covered by a nonce. The only one is the error page that replaces the layout.
    "style-src-attr 'unsafe-inline'",
    // The two-factor QR code is a data: URL generated on the server.
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${development ? " ws: wss:" : ""}`,
    "manifest-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  return directives.join("; ");
}
