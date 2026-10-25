import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/platform/i18n/request.ts");

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  // Baseline for every response, including the static files the proxy does not see. HTML pages get the strict
  // nonce-based Content-Security-Policy from src/proxy.ts, which replaces the one below on those responses.
  headers: async () => [{
    source: "/:path*",
    headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'" },
    ],
  }],
  // A bank statement (up to 4 MB, see banking/domain/statement.ts) travels in a Server Action; the default limit is 1 MB.
  experimental: { serverActions: { bodySizeLimit: "5mb" } },
  // Native or worker-based packages are loaded from node_modules at runtime instead of being bundled.
  serverExternalPackages: ["@node-rs/argon2", "pino", "pg"],
};

export default withNextIntl(nextConfig);
