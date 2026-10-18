import { defineConfig } from "prisma/config";

// Prisma 7 no longer reads .env by itself. Real environment variables (Docker, CI) always win.
try {
  process.loadEnvFile(".env");
} catch {
  // no .env file: variables come from the environment
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    // `prisma generate` does not connect; a placeholder keeps it usable without a database (Docker build).
    url: process.env.DATABASE_URL ?? "postgresql://placeholder:placeholder@localhost:5432/placeholder",
  },
});
