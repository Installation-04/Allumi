import "server-only";
import { z } from "zod";
import { recordEvent } from "@/modules/audit";
import { requireRole } from "@/modules/companies";
import { isValidIsoDate, MAX_LINE_CENTS, reasonSchema } from "@/modules/ledger";
import { AppError, isConflict, toAppError } from "@/platform/errors";
import { withCompany, type CompanyContext, type Tx } from "@/platform/tenant";
import { balanceSign, lineProblem, MAX_WORKSHEET_LINES, statementDateProblem } from "../domain/reconciliation";
import { entryNumberFormat, lineSelect, toLineDto, type LedgerLineDto } from "./match-read";

const SUBTYPES = ["CASH", "BANK", "CREDIT_CARD"];
const idSchema = z.uuid();

export type ReconciliationStatus = "IN_PROGRESS" | "COMPLETED";

export type ReconciliationDto = {
  id: string;
  accountId: string;
  accountCode: string;
  accountNameFr: string;
  accountNameEn: string;
  statementDate: string;
  /** As the statement says it: the money in the account, or what is owed on a card. */
  statementBalanceCents: bigint;
  /** −1 on a card: the sums of a worksheet are in ledger terms (debit − credit) and are read times this sign. */
  sign: 1 | -1;
  status: ReconciliationStatus;
  completedAt: Date | null;
  createdAt: Date;
};

export type AccountReconciliation = {
  accountId: string;
  code: string;
  nameFr: string;
  nameEn: string;
  subtype: string;
  inProgress: ReconciliationDto | null;
  lastCompleted: ReconciliationDto | null;
};

export type WorksheetLine = LedgerLineDto & {
  /** Counted by this reconciliation. */
  cleared: boolean;
  /** The statement line it is matched to, when there is one. */
  transaction: { id: string; description: string } | null;
};

export type Worksheet = {
  reconciliation: ReconciliationDto;
  /** The statement's balance, in ledger terms (debit − credit), like every sum below. */
  statementLedgerCents: bigint;
  /** What earlier reconciliations of the account counted. */
  previousCents: bigint;
  /** What this one counts, as saved. */
  clearedCents: bigint;
  lines: WorksheetLine[];
  /** A completed reconciliation can be reopened only when it is the latest of its account. */
  canReopen: boolean;
};

const rowSelect = {
  id: true, accountId: true, statementDate: true, statementBalanceCents: true, status: true, completedAt: true, createdAt: true,
  account: { select: { code: true, nameFr: true, nameEn: true, type: true } },
} as const;

type Row = { id: string; accountId: string; statementDate: Date; statementBalanceCents: bigint; status: ReconciliationStatus; completedAt: Date | null; createdAt: Date; account: { code: string; nameFr: string; nameEn: string; type: string } };

const iso = (date: Date): string => date.toISOString().slice(0, 10);

function toDto(row: Row): ReconciliationDto {
  const sign = balanceSign(row.account.type);
  return {
    id: row.id, accountId: row.accountId, accountCode: row.account.code, accountNameFr: row.account.nameFr, accountNameEn: row.account.nameEn,
    statementDate: iso(row.statementDate), statementBalanceCents: sign * row.statementBalanceCents, sign: sign === 1n ? 1 : -1, status: row.status, completedAt: row.completedAt, createdAt: row.createdAt,
  };
}

async function failing<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw toAppError(error);
  }
}

type Locked = { id: string; accountId: string; statementDate: string; statementBalanceCents: bigint; status: ReconciliationStatus };

/** The reconciliation, locked: two requests on the same one (ticking, completing, reopening) follow each other. */
async function lock(tx: Tx, companyId: string, id: string): Promise<Locked> {
  const rows = await tx.$queryRaw<{ id: string; account_id: string; statement_date: string; statement_balance_cents: bigint; status: ReconciliationStatus }[]>`
    SELECT id, account_id, statement_date::text AS statement_date, statement_balance_cents, status::text AS status
      FROM bank_reconciliation WHERE company_id = ${companyId}::uuid AND id = ${id}::uuid FOR UPDATE`;
  const row = rows[0];
  if (!row) throw new AppError("banking.reconciliationNotFound");
  return { id: row.id, accountId: row.account_id, statementDate: row.statement_date, statementBalanceCents: row.statement_balance_cents, status: row.status };
}

async function lockInProgress(tx: Tx, companyId: string, id: string): Promise<Locked> {
  const row = await lock(tx, companyId, id);
  if (row.status !== "IN_PROGRESS") throw new AppError("banking.reconCompleted");
  return row;
}

/** Debit − credit of the lines counted by reconciliations of an account: the completed ones (those before a day, when given), and one more when given. */
async function countedCents(tx: Tx, companyId: string, accountId: string, options: { completed?: boolean; only?: string; except?: string; before?: string }): Promise<bigint> {
  const rows = await tx.$queryRaw<{ cents: bigint }[]>`
    SELECT coalesce(sum(l.debit_cents - l.credit_cents), 0)::bigint AS cents
      FROM reconciled_line rl
      JOIN bank_reconciliation r ON r.company_id = rl.company_id AND r.id = rl.reconciliation_id
      JOIN journal_line l ON l.company_id = rl.company_id AND l.id = rl.journal_line_id
     WHERE r.company_id = ${companyId}::uuid AND r.account_id = ${accountId}::uuid
       AND (${options.completed ?? false}::boolean AND r.status = 'COMPLETED' OR r.id = ${options.only ?? null}::uuid)
       AND (${options.except ?? null}::uuid IS NULL OR r.id <> ${options.except ?? null}::uuid)
       AND (${options.before ?? null}::date IS NULL OR r.statement_date < ${options.before ?? null}::date)`;
  return rows[0]?.cents ?? 0n;
}

// ------------------------------------------------------------------------------------------------ reading

/** Each account that holds statement lines, with its reconciliation in progress and the last one completed. Every member reads it. */
export async function listAccountReconciliations(actor: CompanyContext): Promise<AccountReconciliation[]> {
  return withCompany(actor, async (tx) => {
    await requireRole(tx, "bank.read");
    const accounts = await tx.account.findMany({
      where: { companyId: actor.companyId, isActive: true, subtype: { in: ["CASH", "BANK", "CREDIT_CARD"] } },
      select: { id: true, code: true, nameFr: true, nameEn: true, subtype: true }, orderBy: { code: "asc" },
    });
    const rows = await tx.bankReconciliation.findMany({
      where: { companyId: actor.companyId, accountId: { in: accounts.map((account) => account.id) } },
      select: rowSelect, orderBy: [{ statementDate: "desc" }],
    });
    return accounts.map((account) => {
      const own = rows.filter((row) => row.accountId === account.id).map(toDto);
      return { accountId: account.id, code: account.code, nameFr: account.nameFr, nameEn: account.nameEn, subtype: account.subtype, inProgress: own.find((row) => row.status === "IN_PROGRESS") ?? null, lastCompleted: own.find((row) => row.status === "COMPLETED") ?? null };
    });
  });
}

/** The reconciliations of an account, newest first. */
export async function listReconciliations(actor: CompanyContext, accountId: string): Promise<ReconciliationDto[]> {
  if (!idSchema.safeParse(accountId).success) return [];
  return withCompany(actor, async (tx) => {
    await requireRole(tx, "bank.read");
    const rows = await tx.bankReconciliation.findMany({ where: { companyId: actor.companyId, accountId }, select: rowSelect, orderBy: [{ statementDate: "desc" }], take: 100 });
    return rows.map(toDto);
  });
}

/**
 * The worksheet of a reconciliation. In progress: every line of the account dated on or before the statement that no
 * other reconciliation counted, each with whether this one counts it. Completed: the lines it counted. Null when
 * there is no such reconciliation in this company.
 */
export async function getWorksheet(actor: CompanyContext, id: string): Promise<Worksheet | null> {
  if (!idSchema.safeParse(id).success) return null;
  return withCompany(actor, async (tx) => {
    await requireRole(tx, "bank.read");
    const row = await tx.bankReconciliation.findFirst({ where: { companyId: actor.companyId, id }, select: rowSelect });
    if (!row) return null;
    const reconciliation = toDto(row);
    const date = row.statementDate;
    const lineRows = await tx.journalLine.findMany({
      where: {
        companyId: actor.companyId, accountId: row.accountId, entryDate: { lte: date },
        ...(row.status === "IN_PROGRESS" ? { OR: [{ reconciledLine: null }, { reconciledLine: { reconciliationId: id } }] } : { reconciledLine: { reconciliationId: id } }),
      },
      select: { ...lineSelect, reconciledLine: { select: { reconciliationId: true, reconciliation: { select: { status: true } } } }, bankMatch: { select: { bankTransaction: { select: { id: true, description: true } } } } },
      orderBy: [{ entryDate: "asc" }, { entry: { entryNumber: "asc" } }, { lineNo: "asc" }],
      take: MAX_WORKSHEET_LINES + 1,
    });
    if (lineRows.length > MAX_WORKSHEET_LINES) throw new AppError("banking.reconTooMany");
    const format = await entryNumberFormat(tx, actor.companyId);
    const lines = lineRows.map((line): WorksheetLine => ({
      ...toLineDto(line, format), cleared: line.reconciledLine?.reconciliationId === id,
      transaction: line.bankMatch ? { id: line.bankMatch.bankTransaction.id, description: line.bankMatch.bankTransaction.description } : null,
    }));
    const previousCents = await countedCents(tx, actor.companyId, row.accountId, { completed: true, except: id, before: reconciliation.statementDate });
    const clearedCents = await countedCents(tx, actor.companyId, row.accountId, { only: id });
    const later = await tx.bankReconciliation.count({ where: { companyId: actor.companyId, accountId: row.accountId, status: "COMPLETED", statementDate: { gt: date } } });
    return {
      reconciliation, statementLedgerCents: row.statementBalanceCents, previousCents, clearedCents, lines,
      canReopen: row.status === "COMPLETED" && later === 0,
    };
  });
}

// ------------------------------------------------------------------------------------------------ changing

const startSchema = z.object({
  accountId: idSchema,
  statementDate: z.string().refine(isValidIsoDate),
  statementBalanceCents: z.bigint().min(-MAX_LINE_CENTS).max(MAX_LINE_CENTS),
});

/**
 * Starts the reconciliation of an account against a statement (owner and accountant): the statement's closing day and
 * balance, as the statement says it. One at a time per account, and for a day after the last one completed.
 */
export async function startReconciliation(actor: CompanyContext, input: { accountId: string; statementDate: string; statementBalanceCents: bigint }): Promise<{ id: string }> {
  const parsed = startSchema.safeParse(input);
  if (!parsed.success) throw new AppError("banking.reconInvalid");
  return failing(() =>
    withCompany(actor, async (tx) => {
      await requireRole(tx, "bank.manage");
      const accounts = await tx.$queryRaw<{ id: string; type: string }[]>`
        SELECT id, type::text AS type FROM account
         WHERE company_id = ${actor.companyId}::uuid AND id = ${parsed.data.accountId}::uuid AND is_active AND subtype::text = ANY(${SUBTYPES}::text[]) FOR UPDATE`;
      const account = accounts[0];
      if (!account) throw new AppError("banking.account");
      if (await tx.bankReconciliation.findFirst({ where: { companyId: actor.companyId, accountId: account.id, status: "IN_PROGRESS" }, select: { id: true } })) throw new AppError("banking.reconInProgress");
      const last = await tx.bankReconciliation.findFirst({ where: { companyId: actor.companyId, accountId: account.id, status: "COMPLETED" }, orderBy: { statementDate: "desc" }, select: { statementDate: true } });
      if (statementDateProblem(parsed.data.statementDate, last ? iso(last.statementDate) : null)) throw new AppError("banking.reconDateOrder");
      try {
        const created = await tx.bankReconciliation.create({
          data: { companyId: actor.companyId, accountId: account.id, statementDate: new Date(`${parsed.data.statementDate}T00:00:00Z`), statementBalanceCents: balanceSign(account.type) * parsed.data.statementBalanceCents, createdById: actor.userId },
          select: { id: true },
        });
        return { id: created.id };
      } catch (error) {
        if (isConflict(error)) throw new AppError("banking.reconInProgress");
        throw error;
      }
    }),
  );
}

/**
 * Sets the lines this reconciliation counts to exactly these (owner and accountant), from those of the worksheet:
 * lines of its account dated on or before the statement that no other reconciliation counted. Ticking is saved as a
 * whole, so what the person sees is what is kept.
 */
export async function saveCleared(actor: CompanyContext, reconciliationId: string, lineIds: readonly string[]): Promise<void> {
  const ids = z.array(idSchema).max(MAX_WORKSHEET_LINES).safeParse(lineIds);
  if (!idSchema.safeParse(reconciliationId).success || !ids.success) throw new AppError("banking.invalid");
  const wanted = new Set(ids.data);
  return failing(() =>
    withCompany(actor, async (tx) => {
      await requireRole(tx, "bank.manage");
      const rec = await lockInProgress(tx, actor.companyId, reconciliationId);
      const found = await tx.journalLine.findMany({
        where: { companyId: actor.companyId, id: { in: [...wanted] } },
        select: { id: true, accountId: true, entryDate: true, reconciledLine: { select: { reconciliationId: true } } },
      });
      if (found.length !== wanted.size) throw new AppError("banking.reconLine");
      for (const line of found) {
        const problem = lineProblem({ accountId: line.accountId, entryDate: iso(line.entryDate) }, { accountId: rec.accountId, statementDate: rec.statementDate });
        if (problem) throw new AppError(problem === "account" ? "banking.reconLine" : "banking.reconLineLate");
        if (line.reconciledLine && line.reconciledLine.reconciliationId !== rec.id) throw new AppError("banking.reconLineTaken");
      }
      const current = await tx.reconciledLine.findMany({ where: { companyId: actor.companyId, reconciliationId: rec.id }, select: { journalLineId: true } });
      const have = new Set(current.map((line) => line.journalLineId));
      const remove = [...have].filter((id) => !wanted.has(id));
      const add = [...wanted].filter((id) => !have.has(id));
      if (remove.length > 0) await tx.reconciledLine.deleteMany({ where: { companyId: actor.companyId, reconciliationId: rec.id, journalLineId: { in: remove } } });
      if (add.length > 0) await tx.reconciledLine.createMany({ data: add.map((journalLineId) => ({ companyId: actor.companyId, reconciliationId: rec.id, journalLineId })) });
    }),
  );
}

/**
 * Counts every line that is matched to a statement line (owner and accountant), on top of what is already counted:
 * the lines the statement itself proves. Returns how many were added.
 */
export async function clearMatchedLines(actor: CompanyContext, reconciliationId: string): Promise<number> {
  if (!idSchema.safeParse(reconciliationId).success) throw new AppError("banking.reconciliationNotFound");
  return failing(() =>
    withCompany(actor, async (tx) => {
      await requireRole(tx, "bank.manage");
      const rec = await lockInProgress(tx, actor.companyId, reconciliationId);
      const lines = await tx.journalLine.findMany({
        where: { companyId: actor.companyId, accountId: rec.accountId, entryDate: { lte: new Date(`${rec.statementDate}T00:00:00Z`) }, reconciledLine: null, bankMatch: { isNot: null } },
        select: { id: true }, take: MAX_WORKSHEET_LINES + 1,
      });
      if (lines.length > MAX_WORKSHEET_LINES) throw new AppError("banking.reconTooMany");
      if (lines.length > 0) await tx.reconciledLine.createMany({ data: lines.map((line) => ({ companyId: actor.companyId, reconciliationId: rec.id, journalLineId: line.id })) });
      return lines.length;
    }),
  );
}

/**
 * Completes the reconciliation (owner and accountant) when the lines counted so far, with those of the earlier
 * statements, come to exactly the statement's balance. It is then frozen. The database checks the balance again.
 */
export async function completeReconciliation(actor: CompanyContext, reconciliationId: string): Promise<void> {
  if (!idSchema.safeParse(reconciliationId).success) throw new AppError("banking.reconciliationNotFound");
  return failing(() =>
    withCompany(actor, async (tx) => {
      await requireRole(tx, "bank.manage");
      const rec = await lockInProgress(tx, actor.companyId, reconciliationId);
      const counted = await countedCents(tx, actor.companyId, rec.accountId, { completed: true, only: rec.id });
      if (counted !== rec.statementBalanceCents) throw new AppError("banking.reconDifference");
      await tx.bankReconciliation.update({ where: { companyId_id: { companyId: actor.companyId, id: rec.id } }, data: { status: "COMPLETED", completedAt: new Date(), completedById: actor.userId } });
    }),
  );
}

/**
 * Reopens the latest completed reconciliation of an account (owner and accountant), with a written reason that goes
 * to the audit trail: its lines can be ticked again, and the matches of its lines undone. Not while another one is in
 * progress on the account.
 */
export async function reopenReconciliation(actor: CompanyContext, reconciliationId: string, reason: string): Promise<void> {
  if (!idSchema.safeParse(reconciliationId).success) throw new AppError("banking.reconciliationNotFound");
  const why = reasonSchema.safeParse(reason);
  if (!why.success) throw new AppError("banking.reconReason");
  return failing(() =>
    withCompany(actor, async (tx) => {
      await requireRole(tx, "bank.manage");
      const rec = await lock(tx, actor.companyId, reconciliationId);
      if (rec.status !== "COMPLETED") throw new AppError("banking.reconNotCompleted");
      if (await tx.bankReconciliation.findFirst({ where: { companyId: actor.companyId, accountId: rec.accountId, status: "IN_PROGRESS" }, select: { id: true } })) throw new AppError("banking.reconInProgress");
      if (await tx.bankReconciliation.findFirst({ where: { companyId: actor.companyId, accountId: rec.accountId, status: "COMPLETED", statementDate: { gt: new Date(`${rec.statementDate}T00:00:00Z`) } }, select: { id: true } })) throw new AppError("banking.reconNotLatest");
      try {
        await tx.bankReconciliation.update({ where: { companyId_id: { companyId: actor.companyId, id: rec.id } }, data: { status: "IN_PROGRESS", completedAt: null, completedById: null } });
      } catch (error) {
        if (isConflict(error)) throw new AppError("banking.reconInProgress");
        throw error;
      }
      await recordEvent(tx, { action: "bank_reconciliation.reopen", entityType: "bank_reconciliation", entityId: rec.id, data: { reason: why.data, statementDate: rec.statementDate } });
    }),
  );
}

/** Abandons a reconciliation in progress (owner and accountant): its ticks are removed, nothing else changes. A completed one is never deleted. */
export async function discardReconciliation(actor: CompanyContext, reconciliationId: string): Promise<void> {
  if (!idSchema.safeParse(reconciliationId).success) throw new AppError("banking.reconciliationNotFound");
  return failing(() =>
    withCompany(actor, async (tx) => {
      await requireRole(tx, "bank.manage");
      const rec = await lockInProgress(tx, actor.companyId, reconciliationId);
      await tx.reconciledLine.deleteMany({ where: { companyId: actor.companyId, reconciliationId: rec.id } });
      await tx.bankReconciliation.delete({ where: { companyId_id: { companyId: actor.companyId, id: rec.id } } });
    }),
  );
}
