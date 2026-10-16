import "server-only";
import { z } from "zod";

const postgresUrl = z
  .string()
  .regex(/^postgres(ql)?:\/\//, "must be a postgresql:// URL");

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    APP_URL: z.url(),
    APP_VERSION: z.string().optional(),
    APP_DATABASE_URL: postgresUrl,
    // Owner credentials are for the migrate service only. When present they must differ.
    DATABASE_URL: postgresUrl.optional(),
    AUTH_SECRET: z.string().min(32, "must be at least 32 characters"),
    ENCRYPTION_KEY: z
      .string()
      .refine((value) => Buffer.from(value, "base64").length === 32, "must be 32 bytes encoded in base64"),
    LOG_LEVEL: z.enum(["silent", "fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
    DEFAULT_LOCALE: z.enum(["fr-CA", "en"]).default("fr-CA"),
    // Reverse proxies between the internet and the app (the bundled Caddy is one). The client address
    // is the entry of X-Forwarded-For that many places from the right.
    TRUSTED_PROXY_HOPS: z.coerce.number().int().min(1).max(5).default(1),
    // When set, /setup asks for it: nobody who merely reaches the URL first can claim the instance.
    SETUP_TOKEN: z.string().min(16, "must be at least 16 characters").optional(),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().positive().default(587),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    SMTP_FROM: z.string().optional(),
  })
  .refine((env) => env.DATABASE_URL === undefined || env.DATABASE_URL !== env.APP_DATABASE_URL, {
    path: ["APP_DATABASE_URL"],
    message: "must use the allumi_app role, not the owner credentials of DATABASE_URL",
  });

export type Env = z.infer<typeof schema>;

/** Parses the environment. Throws one readable message listing every invalid variable. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== undefined && value !== ""));
  const result = schema.safeParse(cleaned);
  if (!result.success) {
    const lines = result.error.issues.map((issue) => `  - ${issue.path.join(".") || "(env)"}: ${issue.message}`);
    throw new Error(`Invalid configuration (see .env.example and docs/Configuration.md):\n${lines.join("\n")}`);
  }
  return result.data;
}

let cached: Env | undefined;

export function env(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
