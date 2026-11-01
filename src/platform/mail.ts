import "server-only";
import nodemailer from "nodemailer";
import { z } from "zod";
import { env, type Env } from "./env";
import { AppError } from "./errors";

export function smtpConfig(config: Pick<Env, "SMTP_HOST" | "SMTP_PORT" | "SMTP_USER" | "SMTP_PASSWORD" | "SMTP_FROM" | "SMTP_SECURITY">) {
  const from = config.SMTP_FROM?.trim() ?? "";
  const match = /^([^<>\r\n]{1,100}) <([^<>]+)>$/.exec(from);
  const address = match ? match[2] : from;
  if (!config.SMTP_HOST || /[\s/\x00-\x1f]/.test(config.SMTP_HOST) || !z.email().max(254).safeParse(address).success || /[\r\n]/.test(from)
      || Boolean(config.SMTP_USER) !== Boolean(config.SMTP_PASSWORD)) throw new AppError("invoiceEmail.config");
  return { from: { name: match?.[1] ?? "Allumi", address }, host: config.SMTP_HOST, port: config.SMTP_PORT,
    secure: config.SMTP_SECURITY === "tls", requireTLS: config.SMTP_SECURITY === "starttls", ignoreTLS: config.SMTP_SECURITY === "plain",
    auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD! } : undefined,
    connectionTimeout: 5_000, greetingTimeout: 5_000, socketTimeout: 10_000,
    disableFileAccess: true, disableUrlAccess: true, logger: false as const, debug: false };
}
export function mailConfigured(): boolean {
  try { smtpConfig(env()); return true; } catch { return false; }
}
export function requireMailConfigured() { smtpConfig(env()); }

/** A transport failure can occur after DATA was accepted. Never retry it automatically. */
export async function deliverMail(message: { to: string; subject: string; text: string; html: string; attemptId: string }): Promise<"ACCEPTED" | "FAILED" | "UNKNOWN"> {
  const config = smtpConfig(env());
  const transport = nodemailer.createTransport(config);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([transport.sendMail({ from: config.from, to: { address: message.to, name: "" },
      subject: message.subject, text: message.text, html: message.html,
      messageId: `<${message.attemptId}@${config.from.address!.split("@")[1]}>`,
      disableFileAccess: true, disableUrlAccess: true }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("SMTP deadline")), 15_000); })]);
    return result.accepted.length === 1 ? "ACCEPTED" : "FAILED";
  } catch (error) {
    const code = error && typeof error === "object" && "responseCode" in error ? error.responseCode : undefined;
    return typeof code === "number" && code >= 400 && code < 600 ? "FAILED" : "UNKNOWN";
  }
  finally { clearTimeout(timer); transport.close(); }
}
