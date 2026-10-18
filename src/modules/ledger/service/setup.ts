import "server-only";
import { requireRole } from "@/modules/companies";
import { nextFreeCode } from "../domain/accounts";
import { CANADIAN_CHART } from "../domain/chart";
import { fiscalYearContaining, monthlyPeriods } from "../domain/periods";
import { toDbDate, todayIso } from "./dates";
import { inCompany, type Actor } from "./support";

const SEQUENCES = [
  { key: "JOURNAL_ENTRY", prefix: "J-", padding: 5 },
  { key: "INVOICE", prefix: "F-", padding: 5 },
  { key: "CREDIT_NOTE", prefix: "AV-", padding: 5 },
  { key: "PURCHASE_DOCUMENT", prefix: "A-", padding: 5 },
  { key: "PAYMENT_RECEIVED", prefix: "E-", padding: 5 },
  { key: "PAYMENT_SENT", prefix: "D-", padding: 5 },
  { key: "DEPOSIT", prefix: "DP-", padding: 5 },
] as const;

export type LedgerStatus = { initialized: boolean; accounts: number; fiscalYears: number };

const SYSTEM_ACCOUNT_COUNT = CANADIAN_CHART.filter((account) => account.systemKey).length;

export async function ledgerStatus(actor: Actor): Promise<LedgerStatus> {
  return inCompany(actor, async (tx) => {
    await requireRole(tx, "ledger.read");
    const [accounts, systemAccounts, fiscalYears, sequences] = await Promise.all([
      tx.account.count({ where: { companyId: actor.companyId } }),
      tx.account.count({ where: { companyId: actor.companyId, systemKey: { not: null } } }),
      tx.fiscalYear.count({ where: { companyId: actor.companyId } }),
      tx.numberSequence.count({ where: { companyId: actor.companyId } }),
    ]);
    return { initialized: systemAccounts >= SYSTEM_ACCOUNT_COUNT && fiscalYears > 0 && sequences >= SEQUENCES.length, accounts, fiscalYears };
  });
}

/**
 * Gives a new company what the engine needs: numbering sequences, the starter chart of accounts and the
 * fiscal year of today with its monthly periods. Safe to run again, and by two requests at once: it only adds
 * what is missing. The starter chart goes in whole into a company with no account; in a company that already has
 * some, only the system accounts (receivables, payables, undeposited funds, retained earnings, opening balances)
 * are added if they are missing, since other modules find them by their key.
 */
export async function initializeLedger(actor: Actor, now: Date = new Date()): Promise<LedgerStatus> {
  await inCompany(actor, async (tx) => {
    await requireRole(tx, "account.manage");
    const companyId = actor.companyId;
    // Two requests (a double click) take turns: the second one finds what the first one made.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ledger-init:${companyId}`}, 0))`;

    await tx.numberSequence.createMany({ data: SEQUENCES.map((sequence) => ({ companyId, ...sequence })), skipDuplicates: true });

    const existing = await tx.account.findMany({ where: { companyId }, select: { code: true, systemKey: true } });
    const wanted = existing.length === 0 ? CANADIAN_CHART : CANADIAN_CHART.filter((account) => account.systemKey && !existing.some((row) => row.systemKey === account.systemKey));
    const taken = new Set(existing.map((row) => row.code));
    for (const account of wanted) {
      const code = nextFreeCode(taken, account.code);
      taken.add(code);
      await tx.account.create({
        data: { companyId, code, nameFr: account.nameFr, nameEn: account.nameEn, type: account.type, subtype: account.subtype, systemKey: account.systemKey ?? null },
      });
    }

    if ((await tx.fiscalYear.count({ where: { companyId } })) === 0) {
      const company = await tx.company.findUniqueOrThrow({ where: { id: companyId }, select: { fiscalYearStartMonth: true } });
      const bounds = fiscalYearContaining(todayIso(now), company.fiscalYearStartMonth);
      const year = await tx.fiscalYear.create({ data: { companyId, startDate: toDbDate(bounds.start), endDate: toDbDate(bounds.end) } });
      await tx.fiscalPeriod.createMany({
        data: monthlyPeriods(bounds).map((period) => ({
          companyId,
          fiscalYearId: year.id,
          periodNumber: period.number,
          startDate: toDbDate(period.start),
          endDate: toDbDate(period.end),
        })),
      });
    }
  });
  return ledgerStatus(actor);
}
