import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/platform/i18n/request.ts");

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  // Native or worker-based packages are loaded from node_modules at runtime instead of being bundled.
  serverExternalPackages: ["@node-rs/argon2", "pino", "pg"],
};

export default withNextIntl(nextConfig);
