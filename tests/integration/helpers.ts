import { randomUUID } from "node:crypto";
import pg from "pg";
import { Secret, TOTP } from "otpauth";
import { beginTotpEnrollment, confirmTotpEnrollment } from "@/modules/auth";
import { hashPassword } from "@/modules/auth/service/crypto";

/** Direct owner connection to this file's database (fixtures and low-level checks only). */
export async function owner(): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  return client;
}

export const PASSWORD = "une phrase de passe très longue 2026";

export async function seedUser(db: pg.Client, input: { email: string; password?: string; admin?: boolean; name?: string }): Promise<string> {
  const id = randomUUID();
  await db.query(
    "INSERT INTO app_user (id, email, display_name, is_instance_admin, updated_at) VALUES ($1, $2, $3, $4, now())",
    [id, input.email, input.name ?? input.email, input.admin ?? false],
  );
  await db.query(
    "INSERT INTO user_credential (user_id, password_hash, password_changed_at, updated_at) VALUES ($1, $2, now(), now())",
    [id, await hashPassword(input.password ?? PASSWORD)],
  );
  return id;
}

export async function seedCompany(db: pg.Client, name: string, members: { userId: string; role: "OWNER" | "ACCOUNTANT" | "READ_ONLY" }[]): Promise<string> {
  const id = randomUUID();
  await db.query("INSERT INTO company (id, name, updated_at) VALUES ($1, $2, now())", [id, name]);
  for (const member of members) {
    await db.query("INSERT INTO membership (id, company_id, user_id, role, updated_at) VALUES ($1, $2, $3, $4, now())", [
      randomUUID(),
      id,
      member.userId,
      member.role,
    ]);
  }
  return id;
}

/** Runs a function and returns the error it throws (or fails the test). */
export async function thrown(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to throw");
}

/**
 * Turns two-factor authentication on for a user, for real (encrypted secret, recovery codes), at the instant `at`.
 * `code(t)` is the code that the authenticator shows at time `t`. A code works once, and only for a later 30 s step
 * than the last accepted one: to use several, ask for them at instants `at + 30 s`, `at + 60 s`...
 */
export async function enableTotp(userId: string, email: string, at: number = Date.now(), password: string = PASSWORD): Promise<{ code: (timestamp: number) => string; enrolledAt: number; recoveryCodes: string[] }> {
  const enrollment = await beginTotpEnrollment(userId, email);
  if (!enrollment) throw new Error("no enrollment");
  const code = (timestamp: number) => new TOTP({ secret: Secret.fromBase32(enrollment.secret), digits: 6, period: 30 }).generate({ timestamp });
  const confirmed = await confirmTotpEnrollment(userId, code(at), password, { now: new Date(at) });
  if (confirmed.status !== "ok") throw new Error(`2FA not confirmed: ${confirmed.status}`);
  return { code, enrolledAt: at, recoveryCodes: confirmed.recoveryCodes };
}
