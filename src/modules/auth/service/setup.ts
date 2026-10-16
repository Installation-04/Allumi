import "server-only";
import { randomUUID } from "node:crypto";
import { withAnonymous } from "@/platform/tenant";
import { checkPassword, normalizeEmail } from "../domain/password";
import { RATE_LIMITS } from "../domain/policy";
import type { SetupInput } from "../domain/schemas";
import { hashPassword } from "./crypto";
import { hit } from "./rate-limit";

export async function isSetUp(): Promise<boolean> {
  const rows = await withAnonymous((tx) => tx.$queryRaw<{ set_up: boolean }[]>`SELECT auth_instance_is_set_up() AS set_up`);
  return rows[0]?.set_up === true;
}

export type SetupResult =
  | { status: "ok"; userId: string; companyId: string }
  | { status: "already_set_up" }
  | { status: "rate_limited" }
  | { status: "weak_password"; problem: "tooShort" | "tooLong" | "sameAsEmail" };

/** First start only: creates the instance administrator and the first company, in one transaction. */
export async function setupInstance(input: SetupInput, ip: string): Promise<SetupResult> {
  if (!(await hit("setup:ip", ip, RATE_LIMITS.setupIp)).allowed) return { status: "rate_limited" };
  const email = normalizeEmail(input.email);
  const problem = checkPassword(input.password, email);
  if (problem) return { status: "weak_password", problem };

  const userId = randomUUID();
  const companyId = randomUUID();
  const passwordHash = await hashPassword(input.password);
  try {
    await withAnonymous(
      (tx) => tx.$executeRaw`SELECT app_setup_instance(
        ${userId}::uuid, ${email}, ${input.displayName}, ${passwordHash}, ${input.locale}::app_locale,
        ${companyId}::uuid, ${input.companyName}, ${input.fiscalYearStartMonth}::int)`,
    );
  } catch (error) {
    if (await isSetUp()) return { status: "already_set_up" };
    throw error;
  }
  return { status: "ok", userId, companyId };
}
