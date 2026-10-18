import "server-only";
import { requireRole } from "@/modules/companies";
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

export async function ledgerStatus(actor: Actor): Promise<LedgerStatus> {
  return inCompany(actor, async (tx) => {
    await requireRole(tx, "ledger.read");
    const [accounts, fiscalYears, sequences] = await Promise.all([
      tx.account.count({ where: { companyId: actor.companyId } }),
      tx.fiscalYear.count({ where: { companyId: actor.companyId } }),
      tx.numberSequence.count({ where: { companyId: actor.companyId } }),
    ]);
    return { initialized: accounts > 0 && fiscalYears > 0 && sequences >= SEQUENCES.length, accounts, fiscalYears };
  });
}

/**
 * Gives a new company what the engine needs: numbering sequences, the starter chart of accounts and the
 * fiscal year of today with its monthly periods. Safe to run again: it only adds what is missing.
 */
export async function initializeLedger(actor: Actor, now: Date = new Date()): Promise<LedgerStatus> {
  await inCompany(actor, async (tx) => {
    await requireRole(tx, "account.manage");
    const companyId = actor.companyId;

    await tx.numberSequence.createMany({ data: SEQUENCES.map((sequence) => ({ companyId, ...sequence })), skipDuplicates: true });

    if ((await tx.account.count({ where: { companyId } })) === 0) {
      await tx.account.createMany({
        data: CANADIAN_CHART.map((account) => ({
          companyId,
          code: account.code,
          nameFr: account.nameFr,
          nameEn: account.nameEn,
          type: account.type,
          subtype: account.subtype,
          systemKey: account.systemKey ?? null,
        })),
        skipDuplicates: true,
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
