import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireRole } from "@/modules/companies";
import { isValidIsoDate, todayIso } from "@/modules/ledger";
import { AppError, isConflict, toAppError } from "@/platform/errors";
import { encrypt } from "@/platform/secrets";
import { withCompany, type CompanyContext } from "@/platform/tenant";
import { createConnector, fetchHttp, type HttpClient } from "../connectors";
import { parseCredentials, type Credentials } from "../domain/credentials";
import { PROVIDERS, type ProviderId } from "../domain/provider";
import { DAY_MS } from "../domain/windows";

/** Test doubles for the network and the clock. */
export type Deps = { http?: HttpClient; now?: Date };

/** The key of the credentials of one connection: a blob moved to another row, company or use does not decrypt. */
export const CREDENTIAL_PURPOSE = "integration-credentials";
export const credentialBinding = (companyId: string, connectionId: string) => ({ purpose: CREDENTIAL_PURPOSE, context: `${companyId}:${connectionId}` });

/** PayPal's reporting keeps three years; ask for less so the first request is never refused for its age. */
const PAYPAL_LOOKBACK_DAYS = 1090;

const connectionSchema = z.object({
  provider: z.enum(PROVIDERS),
  label: z.string().trim().min(1).max(60),
  accountId: z.string().uuid(),
  importFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  environment: z.enum(["live", "sandbox"]).default("live"),
  credentials: z.record(z.string(), z.string()),
});
export type ConnectionInput = z.input<typeof connectionSchema>;

export type ConnectionDto = {
  id: string;
  provider: ProviderId;
  label: string;
  accountId: string;
  accountCode: string;
  accountNameFr: string;
  accountNameEn: string;
  status: "ACTIVE" | "DISABLED";
  sandbox: boolean;
  credentialsHint: string | null;
  importFrom: string;
  lastSyncedAt: Date | null;
  lastSyncOk: boolean | null;
  lastError: string | null;
  lastImportedCount: number | null;
  syncing: boolean;
  transactionCount: number;
};

const SELECT = {
  id: true, provider: true, label: true, accountId: true, status: true, sandbox: true, credentialsHint: true, importFrom: true, lastSyncedAt: true,
  lastSyncOk: true, lastError: true, lastImportedCount: true, syncingSince: true,
  account: { select: { code: true, nameFr: true, nameEn: true } },
  _count: { select: { transactions: true } },
} as const;

type Row = {
  id: string; provider: ProviderId; label: string; accountId: string; status: "ACTIVE" | "DISABLED"; sandbox: boolean; credentialsHint: string | null; importFrom: Date;
  lastSyncedAt: Date | null; lastSyncOk: boolean | null; lastError: string | null; lastImportedCount: number | null; syncingSince: Date | null;
  account: { code: string; nameFr: string; nameEn: string }; _count: { transactions: number };
};

const toDto = (row: Row, now: Date): ConnectionDto => ({
  id: row.id, provider: row.provider, label: row.label, accountId: row.accountId, accountCode: row.account.code, accountNameFr: row.account.nameFr, accountNameEn: row.account.nameEn,
  status: row.status, sandbox: row.sandbox, credentialsHint: row.credentialsHint, importFrom: row.importFrom.toISOString().slice(0, 10), lastSyncedAt: row.lastSyncedAt,
  lastSyncOk: row.lastSyncOk, lastError: row.lastError, lastImportedCount: row.lastImportedCount,
  syncing: row.syncingSince !== null && now.getTime() - row.syncingSince.getTime() < 10 * 60_000, transactionCount: row._count.transactions,
});

export async function listConnections(actor: CompanyContext, deps: Deps = {}): Promise<ConnectionDto[]> {
  return withCompany(actor, async (tx) => {
    await requireRole(tx, "bank.read");
    const rows = await tx.integrationConnection.findMany({ where: { companyId: actor.companyId }, select: SELECT, orderBy: [{ status: "asc" }, { label: "asc" }, { id: "asc" }], take: 100 });
    return rows.map((row) => toDto(row as Row, deps.now ?? new Date()));
  });
}

export async function getConnection(actor: CompanyContext, id: string, deps: Deps = {}): Promise<ConnectionDto | null> {
  return withCompany(actor, async (tx) => {
    await requireRole(tx, "bank.read");
    const row = await tx.integrationConnection.findFirst({ where: { companyId: actor.companyId, id }, select: SELECT });
    return row ? toDto(row as Row, deps.now ?? new Date()) : null;
  });
}

/** The ledger accounts a service's balance can be kept in: active bank accounts. */
export async function listConnectionAccounts(actor: CompanyContext) {
  return withCompany(actor, async (tx) => {
    await requireRole(tx, "bank.read");
    return tx.account.findMany({ where: { companyId: actor.companyId, isActive: true, subtype: "BANK" }, select: { id: true, code: true, nameFr: true, nameEn: true }, orderBy: { code: "asc" } });
  });
}

/** Proves the credentials work by calling the service once. The error says why not; nothing about the key is kept. */
async function verify(provider: ProviderId, credentials: Credentials, sandbox: boolean, http: HttpClient): Promise<void> {
  await createConnector(provider, credentials, { sandbox, http }).verify();
}

/**
 * Connects a service: owner only. The credentials are checked against the service first, then stored encrypted
 * (AES-256-GCM, bound to this connection), together with the first day to import. Nothing is imported yet.
 */
export async function createConnection(actor: CompanyContext, input: unknown, deps: Deps = {}): Promise<{ id: string }> {
  const parsed = connectionSchema.safeParse(input);
  if (!parsed.success) throw new AppError("integrations.invalid");
  const { provider, label, accountId, importFrom, environment } = parsed.data;
  const today = todayIso(deps.now);
  const oldest = provider === "PAYPAL" ? new Date((deps.now ?? new Date()).getTime() - PAYPAL_LOOKBACK_DAYS * DAY_MS).toISOString().slice(0, 10) : "2000-01-01";
  // A real calendar day: Date.parse would let 2026-02-30 roll over to March 2.
  if (!isValidIsoDate(importFrom) || importFrom > today || importFrom < oldest) throw new AppError("integrations.importFrom");
  const credentials = parseCredentials(provider, parsed.data.credentials);
  if (!credentials) throw new AppError("integrations.invalid");
  const sandbox = credentials.provider === "STRIPE" ? credentials.sandbox : environment === "sandbox";

  try {
    await withCompany(actor, async (tx) => {
      await requireRole(tx, "integration.manage");
      if (!(await tx.account.findFirst({ where: { companyId: actor.companyId, id: accountId, isActive: true, subtype: "BANK" }, select: { id: true } }))) throw new AppError("integrations.account");
    });
    await verify(provider, credentials.credentials, sandbox, deps.http ?? fetchHttp);
    const id = randomUUID();
    await withCompany(actor, async (tx) => {
      await requireRole(tx, "integration.manage");
      await tx.integrationConnection.create({
        data: { id, companyId: actor.companyId, provider, label, accountId, sandbox, credentialsHint: credentials.hint, importFrom: new Date(`${importFrom}T00:00:00Z`), createdById: actor.userId },
      });
      await tx.integrationCredential.create({
        data: { companyId: actor.companyId, connectionId: id, credentialsEnc: encrypt(JSON.stringify(credentials.credentials), credentialBinding(actor.companyId, id)) },
      });
    });
    return { id };
  } catch (error) {
    if (isConflict(error)) throw new AppError("integrations.labelTaken");
    throw toAppError(error);
  }
}

/**
 * Replaces the credentials of a connection (a rotated key, a reconnection after a disconnection). They are verified
 * first; they must belong to the same environment as the connection (a test key never replaces a live one).
 */
export async function replaceCredentials(actor: CompanyContext, id: string, input: unknown, deps: Deps = {}): Promise<void> {
  try {
    const connection = await withCompany(actor, async (tx) => {
      await requireRole(tx, "integration.manage");
      return tx.integrationConnection.findFirst({ where: { companyId: actor.companyId, id }, select: { provider: true, sandbox: true } });
    });
    if (!connection) throw new AppError("integrations.notFound");
    const credentials = parseCredentials(connection.provider, input);
    if (!credentials) throw new AppError("integrations.invalid");
    if (credentials.provider === "STRIPE" && credentials.sandbox !== connection.sandbox) throw new AppError("integrations.environment");
    await verify(connection.provider, credentials.credentials, connection.sandbox, deps.http ?? fetchHttp);
    await withCompany(actor, async (tx) => {
      await requireRole(tx, "integration.manage");
      await tx.integrationCredential.update({
        where: { companyId_connectionId: { companyId: actor.companyId, connectionId: id } },
        data: { credentialsEnc: encrypt(JSON.stringify(credentials.credentials), credentialBinding(actor.companyId, id)) },
      });
      await tx.integrationConnection.update({ where: { companyId_id: { companyId: actor.companyId, id } }, data: { status: "ACTIVE", credentialsHint: credentials.hint, lastError: null, lastSyncOk: null } });
    });
  } catch (error) {
    throw toAppError(error);
  }
}

/** Stops importing and erases the credentials. What was imported stays; the connection stays on file. Reconnect with `replaceCredentials`. */
export async function disconnect(actor: CompanyContext, id: string): Promise<void> {
  try {
    await withCompany(actor, async (tx) => {
      await requireRole(tx, "integration.manage");
      if (!(await tx.integrationConnection.findFirst({ where: { companyId: actor.companyId, id }, select: { id: true } }))) throw new AppError("integrations.notFound");
      await tx.integrationCredential.update({ where: { companyId_connectionId: { companyId: actor.companyId, connectionId: id } }, data: { credentialsEnc: null } });
      await tx.integrationConnection.update({ where: { companyId_id: { companyId: actor.companyId, id } }, data: { status: "DISABLED", credentialsHint: null } });
    });
  } catch (error) {
    throw toAppError(error);
  }
}
