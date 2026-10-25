import "server-only";
import { z } from "zod";
import { requireRole } from "@/modules/companies";
import { AppError } from "@/platform/errors";
import type { Prisma } from "@/platform/db";
import { withCompany, type CompanyContext } from "@/platform/tenant";

export const TRANSACTIONS_PER_PAGE = 50;
export const TRANSACTION_STATUSES = ["UNMATCHED", "MATCHED", "EXCLUDED"] as const;
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];
const SERVICE_KINDS = ["PAYMENT", "REFUND", "PAYOUT", "FEE", "DISPUTE", "ADJUSTMENT", "OTHER"] as const;

export type BankAccountDto = { id: string; code: string; nameFr: string; nameEn: string; subtype: "CASH" | "BANK" | "CREDIT_CARD"; unmatchedCount: number };

export type BankTransactionDto = {
  id: string;
  date: string;
  description: string;
  payee: string | null;
  amountCents: bigint;
  currency: string;
  status: TransactionStatus;
  accountId: string;
  accountCode: string;
  accountNameFr: string;
  accountNameEn: string;
  /** Where the line came from: a statement file, an outside service (Stripe, PayPal), or neither. */
  source:
    | { kind: "file"; fileName: string }
    | { kind: "service"; provider: string; label: string; sandbox: boolean; type: string; grossCents: bigint | null; feeCents: bigint | null; reference: string | null; flagged: boolean }
    | { kind: "none" };
};

export type TransactionFilter = { accountId?: string; connectionId?: string; status?: TransactionStatus; q?: string; page?: number };

const detail = (details: unknown, key: string): unknown => (details && typeof details === "object" && !Array.isArray(details) ? (details as Record<string, unknown>)[key] : null);

/** The accounts that hold statement lines, with how many lines wait for a match. */
export async function listBankAccounts(actor: CompanyContext): Promise<BankAccountDto[]> {
  return withCompany(actor, async (tx) => {
    await requireRole(tx, "bank.read");
    const accounts = await tx.account.findMany({
      where: { companyId: actor.companyId, isActive: true, subtype: { in: ["CASH", "BANK", "CREDIT_CARD"] } },
      select: { id: true, code: true, nameFr: true, nameEn: true, subtype: true },
      orderBy: { code: "asc" },
    });
    const counts = await tx.bankTransaction.groupBy({ by: ["accountId"], where: { companyId: actor.companyId, status: "UNMATCHED" }, _count: { _all: true } });
    const unmatched = new Map(counts.map((row) => [row.accountId, row._count._all]));
    return accounts.map((account) => ({ ...account, subtype: account.subtype as BankAccountDto["subtype"], unmatchedCount: unmatched.get(account.id) ?? 0 }));
  });
}

/** The statement lines, newest first, from files and from outside services alike. Every member reads them. */
export async function listBankTransactions(actor: CompanyContext, filter: TransactionFilter = {}) {
  return withCompany(actor, async (tx) => {
    await requireRole(tx, "bank.read");
    // A search is text, not a pattern: LIKE's wildcards are escaped.
    const term = (filter.q ?? "").trim().slice(0, 100).replace(/[\\%_]/g, "\\$&");
    const where: Prisma.BankTransactionWhereInput = {
      companyId: actor.companyId,
      ...(filter.accountId && z.uuid().safeParse(filter.accountId).success ? { accountId: filter.accountId } : {}),
      ...(filter.connectionId && z.uuid().safeParse(filter.connectionId).success ? { connectionId: filter.connectionId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(term ? { OR: [{ description: { contains: term, mode: "insensitive" } }, { payee: { contains: term, mode: "insensitive" } }] } : {}),
    };
    const total = await tx.bankTransaction.count({ where });
    const pageCount = Math.max(1, Math.ceil(total / TRANSACTIONS_PER_PAGE));
    const page = Math.min(Math.max(1, Math.trunc(filter.page ?? 1) || 1), pageCount);
    const rows = await tx.bankTransaction.findMany({
      where,
      select: {
        id: true, txnDate: true, description: true, payee: true, amountCents: true, currency: true, status: true, grossCents: true, feeCents: true, sourceType: true, providerDetails: true, accountId: true,
        account: { select: { code: true, nameFr: true, nameEn: true } },
        import: { select: { fileName: true } },
        connection: { select: { provider: true, label: true, sandbox: true } },
      },
      orderBy: [{ txnDate: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * TRANSACTIONS_PER_PAGE,
      take: TRANSACTIONS_PER_PAGE,
    });
    const transactions: BankTransactionDto[] = rows.map((row) => {
      const reference = detail(row.providerDetails, "reference");
      const kind = detail(row.providerDetails, "kind");
      return {
        id: row.id, date: row.txnDate.toISOString().slice(0, 10), description: row.description, payee: row.payee, amountCents: row.amountCents, currency: row.currency, status: row.status,
        accountId: row.accountId, accountCode: row.account.code, accountNameFr: row.account.nameFr, accountNameEn: row.account.nameEn,
        source: row.connection
          ? {
              kind: "service", provider: row.connection.provider, label: row.connection.label, sandbox: row.connection.sandbox, type: (SERVICE_KINDS as readonly unknown[]).includes(kind) ? (kind as string) : "OTHER",
              grossCents: row.grossCents, feeCents: row.feeCents, reference: typeof reference === "string" ? reference : null, flagged: detail(row.providerDetails, "unusualFeeSign") === true,
            }
          : row.import ? { kind: "file", fileName: row.import.fileName } : { kind: "none" },
      };
    });
    return { transactions, total, page, pageCount };
  });
}

/**
 * Sets a line aside (a duplicate, something that is not the books' business) or brings it back: the only change a
 * statement line allows. A matched line is not touched. Owners and accountants.
 */
export async function setTransactionStatus(actor: CompanyContext, id: string, status: "UNMATCHED" | "EXCLUDED"): Promise<void> {
  return withCompany(actor, async (tx) => {
    await requireRole(tx, "bank.manage");
    const result = await tx.bankTransaction.updateMany({ where: { companyId: actor.companyId, id, status: { in: ["UNMATCHED", "EXCLUDED"] } }, data: { status } });
    if (result.count !== 1) throw new AppError("banking.transactionNotFound");
  });
}
