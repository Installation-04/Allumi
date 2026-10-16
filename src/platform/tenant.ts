import "server-only";
import { prisma, type Prisma } from "./db";

/** Transaction client handed to repositories. */
export type Tx = Prisma.TransactionClient;

export type UserContext = { userId: string; requestId?: string };
export type CompanyContext = UserContext & { companyId: string };

const TX_OPTIONS = { maxWait: 5_000, timeout: 20_000 } as const;

async function setContext(tx: Tx, ctx: { userId?: string; companyId?: string; requestId?: string }): Promise<void> {
  // is_local = true: the setting dies with the transaction, so a pooled connection never leaks it.
  await tx.$executeRaw`SELECT
    set_config('app.user_id', ${ctx.userId ?? ""}, true),
    set_config('app.company_id', ${ctx.companyId ?? ""}, true),
    set_config('app.request_id', ${ctx.requestId ?? ""}, true)`;
}

/**
 * Runs `fn` in one transaction scoped to a user and a company. The database only honours the
 * company if the user is an active member (row level security), whatever the caller passes.
 */
export function withCompany<T>(ctx: CompanyContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma().$transaction(async (tx) => {
    await setContext(tx, ctx);
    return fn(tx);
  }, TX_OPTIONS);
}

/** Scoped to a user, without a company (profile, sessions, company picker). */
export function withUser<T>(ctx: UserContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma().$transaction(async (tx) => {
    await setContext(tx, ctx);
    return fn(tx);
  }, TX_OPTIONS);
}

/** Before sign-in: only the narrow lookup functions and the rate-limit table are reachable. */
export function withAnonymous<T>(fn: (tx: Tx) => Promise<T>, requestId?: string): Promise<T> {
  return prisma().$transaction(async (tx) => {
    await setContext(tx, { requestId });
    return fn(tx);
  }, TX_OPTIONS);
}
