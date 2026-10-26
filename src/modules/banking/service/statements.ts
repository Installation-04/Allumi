import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { requireRole } from "@/modules/companies";
import { AppError, isConflict, toAppError } from "@/platform/errors";
import type { Prisma } from "@/platform/db";
import { withCompany, type CompanyContext } from "@/platform/tenant";
import { csvMappingSchema, type CsvMapping } from "../domain/mapping";
import { readStatement } from "../domain/read";
import { cleanText, decodeStatement, StatementError } from "../domain/statement";

const INSERT_CHUNK = 500;
/** Accounts a statement can describe: the same list the database accepts (`bank_account_check`). */
export const STATEMENT_SUBTYPES = ["CASH", "BANK", "CREDIT_CARD"] as const;

const inputSchema = z.object({ accountId: z.uuid(), fileName: z.string().max(1000) });

export type StatementImport = { id: string; accountId: string; fileName: string; format: "CSV" | "OFX"; importedAt: Date; rowCount: number };
export type ImportResult = {
  importId: string;
  /** Transactions the file holds. */
  read: number;
  /** Those new to this account: stored. */
  imported: number;
  /** Those already on file (an earlier statement overlaps this one): left as they were. */
  duplicates: number;
  /** Rows with nothing in them or an amount of zero. */
  skipped: number;
  firstDate: string;
  lastDate: string;
};

const toAppStatementError = (error: unknown): unknown => (error instanceof StatementError ? new AppError(`banking.${error.code}`) : error);

/**
 * Imports a bank or card statement (CSV or OFX/QFX) into the transactions of one account: owner and accountant.
 *
 * The file is read again here with the same code as the preview, so nothing the browser says is trusted. It is refused
 * whole if any row cannot be read, if it is in another currency than the books' or if the same file was imported on
 * this account before (by its SHA-256). Lines already on file (an earlier, overlapping statement) are left as they
 * were: the bank's id (OFX) or the date, amount, description and rank of the line (CSV) is unique per account, and
 * the account row is locked so two imports of overlapping files cannot interleave. Nothing touches the ledger.
 */
export async function importStatement(actor: CompanyContext, input: { accountId: string; fileName: string; bytes: Uint8Array; mapping?: unknown }): Promise<ImportResult> {
  const parsed = inputSchema.safeParse({ accountId: input.accountId, fileName: input.fileName });
  if (!parsed.success) throw new AppError("banking.invalid");
  const fileName = cleanText(parsed.data.fileName.replace(/^.*[\\/]/, ""), 200) || "statement";
  let statement;
  try {
    statement = readStatement(decodeStatement(input.bytes), { mapping: input.mapping });
  } catch (error) {
    throw toAppStatementError(error);
  }
  if (statement.format === "CSV" && statement.mapping === null) throw new AppError("banking.mapping");
  if (statement.errorCount > 0) throw new AppError("banking.unreadableRows");
  if (statement.lines.length === 0) throw new AppError("banking.noTransactions");
  if (statement.currency !== null && statement.currency !== "CAD") throw new AppError("banking.currency");
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const lines = statement.lines;

  try {
    return await withCompany(actor, async (tx) => {
      await requireRole(tx, "bank.manage");
      const account = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM account
         WHERE company_id = ${actor.companyId}::uuid AND id = ${parsed.data.accountId}::uuid AND is_active
           AND subtype::text IN ('CASH', 'BANK', 'CREDIT_CARD') FOR UPDATE`;
      if (!account[0]) throw new AppError("banking.account");
      if (await tx.bankImport.findFirst({ where: { companyId: actor.companyId, accountId: parsed.data.accountId, fileSha256: sha256 }, select: { id: true } })) throw new AppError("banking.alreadyImported");

      const keys = lines.map((line) => line.dedupeKey);
      const known = new Set((await tx.bankTransaction.findMany({ where: { companyId: actor.companyId, accountId: parsed.data.accountId, dedupeKey: { in: keys } }, select: { dedupeKey: true } })).map((row) => row.dedupeKey));
      const fresh = lines.filter((line) => !known.has(line.dedupeKey));

      const created = await tx.bankImport.create({
        data: { companyId: actor.companyId, accountId: parsed.data.accountId, format: statement.format, fileName, fileSha256: sha256, rowCount: fresh.length, importedById: actor.userId },
        select: { id: true },
      });
      for (let i = 0; i < fresh.length; i += INSERT_CHUNK) {
        await tx.bankTransaction.createMany({
          data: fresh.slice(i, i + INSERT_CHUNK).map((line): Prisma.BankTransactionCreateManyInput => ({
            companyId: actor.companyId, accountId: parsed.data.accountId, importId: created.id, txnDate: new Date(`${line.date}T00:00:00Z`), amountCents: line.amountCents,
            description: line.description, payee: line.payee, externalId: line.externalId, dedupeKey: line.dedupeKey, currency: "CAD", status: "UNMATCHED",
          })),
        });
      }
      // What was learned about this account's files is kept for the next import: the CSV columns, the last four digits.
      const profile = { ...(statement.mapping ? { csvMapping: statement.mapping as unknown as Prisma.InputJsonValue } : {}), ...(statement.accountMask ? { accountMask: statement.accountMask } : {}) };
      if (Object.keys(profile).length > 0) {
        await tx.bankAccountProfile.upsert({
          where: { companyId_accountId: { companyId: actor.companyId, accountId: parsed.data.accountId } },
          create: { companyId: actor.companyId, accountId: parsed.data.accountId, ...profile },
          update: profile,
        });
      }
      const dates = lines.map((line) => line.date).sort();
      return {
        importId: created.id, read: lines.length, imported: fresh.length, duplicates: lines.length - fresh.length, skipped: statement.skipped,
        firstDate: dates[0] ?? "", lastDate: dates[dates.length - 1] ?? "",
      };
    });
  } catch (error) {
    // The only way to meet a unique key here, with the account locked, is a bank id that another importer already used.
    if (isConflict(error)) throw new AppError("banking.alreadyImported");
    throw toAppError(error);
  }
}

/** The CSV columns used on this account's last import, for the form to start from (null when none, or when they no longer parse). */
export async function getSavedMapping(actor: CompanyContext, accountId: string): Promise<CsvMapping | null> {
  if (!z.uuid().safeParse(accountId).success) return null;
  return withCompany(actor, async (tx) => {
    await requireRole(tx, "bank.read");
    const profile = await tx.bankAccountProfile.findFirst({ where: { companyId: actor.companyId, accountId }, select: { csvMapping: true } });
    const parsed = csvMappingSchema.safeParse(profile?.csvMapping);
    return parsed.success ? parsed.data : null;
  });
}

/** The files imported, newest first: on one account, or on all of them. */
export async function listImports(actor: CompanyContext, accountId?: string): Promise<StatementImport[]> {
  if (accountId !== undefined && !z.uuid().safeParse(accountId).success) return [];
  return withCompany(actor, async (tx) => {
    await requireRole(tx, "bank.read");
    const rows = await tx.bankImport.findMany({
      where: { companyId: actor.companyId, ...(accountId ? { accountId } : {}) },
      select: { id: true, accountId: true, fileName: true, format: true, importedAt: true, rowCount: true },
      orderBy: [{ importedAt: "desc" }, { id: "desc" }],
      take: 10,
    });
    return rows.map((row) => ({ id: row.id, accountId: row.accountId, fileName: row.fileName, format: row.format, importedAt: row.importedAt, rowCount: row.rowCount }));
  });
}
