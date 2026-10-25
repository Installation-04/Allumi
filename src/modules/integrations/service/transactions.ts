import "server-only";
import { requireRole } from "@/modules/companies";
import { AppError } from "@/platform/errors";
import { withCompany, type CompanyContext } from "@/platform/tenant";
import type { ProviderId } from "../domain/provider";
import { TRANSACTION_KINDS, type TransactionKind } from "../domain/transaction";

export const IMPORTED_PER_PAGE = 50;

export type ImportedTransactionDto = {
  id: string;
  date: string;
  description: string;
  amountCents: bigint;
  grossCents: bigint | null;
  feeCents: bigint | null;
  currency: string;
  status: "UNMATCHED" | "MATCHED" | "EXCLUDED";
  sourceType: string | null;
  kind: TransactionKind;
  reference: string | null;
  flagged: boolean;
  connectionId: string;
  provider: ProviderId;
  connectionLabel: string;
  sandbox: boolean;
};

export type ImportedFilter = { connectionId?: string; status?: "UNMATCHED" | "MATCHED" | "EXCLUDED"; page?: number };

const kindOf = (details: unknown): TransactionKind => {
  const kind = details && typeof details === "object" && !Array.isArray(details) ? (details as Record<string, unknown>).kind : null;
  return (TRANSACTION_KINDS as readonly unknown[]).includes(kind) ? (kind as TransactionKind) : "OTHER";
};
const detail = (details: unknown, key: string): unknown => (details && typeof details === "object" && !Array.isArray(details) ? (details as Record<string, unknown>)[key] : null);

/** The transactions imported from outside services, newest first. Every member reads them. */
export async function listImportedTransactions(actor: CompanyContext, filter: ImportedFilter = {}) {
  return withCompany(actor, async (tx) => {
    await requireRole(tx, "bank.read");
    const where = { companyId: actor.companyId, connectionId: filter.connectionId ?? { not: null }, ...(filter.status ? { status: filter.status } : {}) };
    const total = await tx.bankTransaction.count({ where });
    const pageCount = Math.max(1, Math.ceil(total / IMPORTED_PER_PAGE));
    const page = Math.min(Math.max(1, Math.trunc(filter.page ?? 1) || 1), pageCount);
    const rows = await tx.bankTransaction.findMany({
      where,
      select: {
        id: true, txnDate: true, description: true, amountCents: true, grossCents: true, feeCents: true, currency: true, status: true, sourceType: true, providerDetails: true, connectionId: true,
        connection: { select: { provider: true, label: true, sandbox: true } },
      },
      orderBy: [{ txnDate: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * IMPORTED_PER_PAGE,
      take: IMPORTED_PER_PAGE,
    });
    const transactions: ImportedTransactionDto[] = rows.flatMap((row) =>
      row.connection && row.connectionId
        ? [{
            id: row.id, date: row.txnDate.toISOString().slice(0, 10), description: row.description, amountCents: row.amountCents, grossCents: row.grossCents, feeCents: row.feeCents, currency: row.currency,
            status: row.status, sourceType: row.sourceType, kind: kindOf(row.providerDetails), reference: typeof detail(row.providerDetails, "reference") === "string" ? (detail(row.providerDetails, "reference") as string) : null,
            flagged: detail(row.providerDetails, "unusualFeeSign") === true, connectionId: row.connectionId, provider: row.connection.provider, connectionLabel: row.connection.label, sandbox: row.connection.sandbox,
          }]
        : []);
    return { transactions, total, page, pageCount };
  });
}

/**
 * Sets a transaction aside (a test charge, a duplicate) or brings it back: the only change an imported transaction
 * allows, like any statement line. A matched transaction is not touched. Owners and accountants.
 */
export async function setImportedStatus(actor: CompanyContext, id: string, status: "UNMATCHED" | "EXCLUDED"): Promise<void> {
  return withCompany(actor, async (tx) => {
    await requireRole(tx, "bank.manage");
    const result = await tx.bankTransaction.updateMany({
      where: { companyId: actor.companyId, id, connectionId: { not: null }, status: { in: ["UNMATCHED", "EXCLUDED"] } },
      data: { status },
    });
    if (result.count !== 1) throw new AppError("integrations.transactionNotFound");
  });
}
