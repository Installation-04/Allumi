import "server-only";
import pino from "pino";
import { appVersion } from "./version";

// Never log secrets or personal information (Law 25).
const REDACTED = [
  "password",
  "*.password",
  "passwordHash",
  "*.passwordHash",
  "token",
  "*.token",
  "secret",
  "*.secret",
  "totp",
  "*.totp",
  "code",
  "*.code",
  "email",
  "*.email",
  "authorization",
  "cookie",
  "req.headers.authorization",
  "req.headers.cookie",
];

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { app: "allumi", version: appVersion() },
  redact: { paths: REDACTED, censor: "[redacted]" },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: { level: (label) => ({ level: label }) },
});
