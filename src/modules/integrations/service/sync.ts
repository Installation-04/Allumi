import "server-only";
import type { Prisma } from "@/platform/db";
import { requireRole } from "@/modules/companies";
import { AppError } from "@/platform/errors";
import { logger } from "@/platform/logger";
import { decrypt } from "@/platform/secrets";
import { withCompany, type CompanyContext, type Tx } from "@/platform/tenant";
import { createConnector, fetchHttp, type Connector, type FetchedWindow } from "../connectors";
import { parseStoredCredentials } from "../domain/credentials";
import type { ProviderId } from "../domain/provider";
import type { ImportedTransaction, SkipReason } from "../domain/transaction";
import { syncStart, windows, type Window } from "../domain/windows";
import { credentialBinding, type Deps } from "./connections";
import { failureCode } from "./failure";

/** One run reads at most this many windows (about two years) and stops after this long: press again to continue. */
const MAX_WINDOWS_PER_RUN = 24;
const BUDGET_MS = 40_000;
/** A run that died leaves its lock behind: after this long another run may take over. */
const STALE_LOCK_MINUTES = 10;
const INSERT_CHUNK = 500;
/** A window that holds too many records is halved, down to this size. */
const MIN_SPLIT_MS = 2 * 3_600_000;

export type SyncResult = { imported: number; skipped: Record<SkipReason, number>; windows: number; complete: boolean };

type Claimed = { id: string; provider: ProviderId; account_id: string; sandbox: boolean; import_from: string; sync_cursor: Date | null };

function merge(a: FetchedWindow, b: FetchedWindow): FetchedWindow {
  return {
    transactions: [...a.transactions, ...b.transactions],
    skipped: { unsupportedCurrency: a.skipped.unsupportedCurrency + b.skipped.unsupportedCurrency, notSettled: a.skipped.notSettled + b.skipped.notSettled },
  };
}

/** Reads a window; one that holds more than a run can read is cut in two and read as two. */
async function fetchWindow(connector: Connector, window: Window, depth = 0): Promise<FetchedWindow> {
  try {
    return await connector.fetchWindow(window);
  } catch (error) {
    const span = window.to.getTime() - window.from.getTime();
    if (error instanceof AppError && error.key === "integrations.tooMany" && depth < 6 && span > MIN_SPLIT_MS) {
      const middle = new Date(window.from.getTime() + Math.floor(span / 2));
      const first = await fetchWindow(connector, { from: window.from, to: middle }, depth + 1);
      return merge(first, await fetchWindow(connector, { from: middle, to: window.to }, depth + 1));
    }
    throw error;
  }
}

const row = (companyId: string, accountId: string, connectionId: string, t: ImportedTransaction): Prisma.BankTransactionCreateManyInput => ({
  companyId, accountId, connectionId, txnDate: new Date(`${t.date}T00:00:00Z`), amountCents: t.amountCents, description: t.description, payee: null, externalId: t.externalId, dedupeKey: t.externalId,
  currency: t.currency, sourceType: t.sourceType, grossCents: t.grossCents, feeCents: t.feeCents, providerDetails: t.details as Prisma.InputJsonValue, status: "UNMATCHED",
});

/** Stores a window's transactions and moves the cursor to its end, together: a failure leaves both where they were. */
async function store(tx: Tx, actor: CompanyContext, claimed: Claimed, transactions: ImportedTransaction[], cursor: Date): Promise<number> {
  await requireRole(tx, "integration.manage");
  let inserted = 0;
  for (let i = 0; i < transactions.length; i += INSERT_CHUNK) {
    // skipDuplicates: a transaction already imported (the windows overlap on purpose) is left as it is.
    const result = await tx.bankTransaction.createMany({ data: transactions.slice(i, i + INSERT_CHUNK).map((t) => row(actor.companyId, claimed.account_id, claimed.id, t)), skipDuplicates: true });
    inserted += result.count;
  }
  await tx.integrationConnection.update({ where: { companyId_id: { companyId: actor.companyId, id: claimed.id } }, data: { syncCursor: cursor } });
  return inserted;
}

/**
 * Imports what is new from a service into the transaction inbox: owner only, one run at a time per connection (a
 * lock that expires), window by window from the cursor (minus an overlap), each window stored with its cursor in one
 * transaction so a failure or a stop resumes where it left off. It never touches the ledger: the inbox only lists
 * what the service reports. Importing twice is harmless (the external id is unique per account).
 */
export async function syncConnection(actor: CompanyContext, id: string, deps: Deps = {}): Promise<SyncResult> {
  const clock = () => deps.now ?? new Date();

  const { claimed, secret } = await withCompany(actor, async (tx) => {
    await requireRole(tx, "integration.manage");
    const rows = await tx.$queryRaw<Claimed[]>`
      UPDATE integration_connection SET syncing_since = now()
       WHERE company_id = ${actor.companyId}::uuid AND id = ${id}::uuid AND status = 'ACTIVE'
         AND (syncing_since IS NULL OR syncing_since < now() - make_interval(mins => ${STALE_LOCK_MINUTES}::int))
   RETURNING id, provider::text AS provider, account_id, sandbox, import_from::text AS import_from, sync_cursor`;
    if (!rows[0]) {
      const existing = await tx.integrationConnection.findFirst({ where: { companyId: actor.companyId, id }, select: { status: true } });
      throw new AppError(!existing ? "integrations.notFound" : existing.status === "ACTIVE" ? "integrations.busy" : "integrations.disabled");
    }
    const credential = await tx.integrationCredential.findFirst({ where: { companyId: actor.companyId, connectionId: id }, select: { credentialsEnc: true } });
    if (!credential?.credentialsEnc) throw new AppError("integrations.disabled"); // rolls the claim back with it
    return { claimed: rows[0], secret: credential.credentialsEnc };
  });

  let imported = 0;
  let windowsDone = 0;
  let complete = false;
  const skipped: Record<SkipReason, number> = { unsupportedCurrency: 0, notSettled: 0 };
  let failure: unknown = null;
  try {
    const credentials = (() => {
      try {
        return parseStoredCredentials(claimed.provider, decrypt(secret, credentialBinding(actor.companyId, id)));
      } catch {
        return null; // wrong key, another row's blob, a damaged one
      }
    })();
    if (!credentials) throw new AppError("integrations.credentials");
    const connector = createConnector(claimed.provider, credentials, { sandbox: claimed.sandbox, http: deps.http ?? fetchHttp });
    const started = Date.now();
    const end = clock();
    const planned = windows(syncStart(claimed.import_from.slice(0, 10), claimed.sync_cursor), end, MAX_WINDOWS_PER_RUN);
    complete = planned.length === 0;
    for (const window of planned) {
      if (Date.now() - started > BUDGET_MS) break;
      const fetched = await fetchWindow(connector, window);
      imported += await withCompany(actor, (tx) => store(tx, actor, claimed, fetched.transactions, window.to));
      skipped.unsupportedCurrency += fetched.skipped.unsupportedCurrency;
      skipped.notSettled += fetched.skipped.notSettled;
      windowsDone++;
      complete = window.to.getTime() >= end.getTime();
    }
  } catch (error) {
    failure = error;
    if (!(error instanceof AppError)) logger.error({ errorName: error instanceof Error ? error.name : typeof error }, "integration sync failed");
  } finally {
    try {
      await withCompany(actor, (tx) =>
        tx.integrationConnection.update({
          where: { companyId_id: { companyId: actor.companyId, id } },
          data: { syncingSince: null, lastSyncedAt: clock(), lastSyncOk: failure === null, lastError: failure === null ? null : failureCode(failure), lastImportedCount: imported },
        }));
    } catch (error) {
      // The lock then expires by itself; what matters is not to hide the first failure behind this one.
      logger.error({ errorName: error instanceof Error ? error.name : typeof error }, "integration sync could not release its lock");
    }
  }
  if (failure !== null) throw new AppError(failureCode(failure));
  return { imported, skipped, windows: windowsDone, complete };
}
