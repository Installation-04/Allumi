import "server-only";
import { requireRole } from "@/modules/companies";
import { recordEvent } from "@/modules/audit";
import { totpStatus, verifySecondFactor } from "@/modules/auth";
import { AppError, isConflict } from "@/platform/errors";
import { isValidIsoDate, type IsoDate } from "../domain/dates";
import { fiscalYearAfter, fiscalYearContaining, monthlyPeriods } from "../domain/periods";
import { reasonSchema } from "../domain/schemas";
import { fromDbDate, toDbDate, todayIso } from "./dates";
import { inCompany, type Actor } from "./support";

export type PeriodDto = { id: string; number: number; start: IsoDate; end: IsoDate; status: "OPEN" | "LOCKED"; lockedAt: Date | null };
export type FiscalYearDto = { id: string; start: IsoDate; end: IsoDate; status: "OPEN" | "CLOSED"; closedAt: Date | null; periods: PeriodDto[] };

/** Fiscal years, newest first, each with its periods in order. */
export async function listFiscalYears(actor: Actor): Promise<FiscalYearDto[]> {
  return inCompany(actor, async (tx) => {
    await requireRole(tx, "ledger.read");
    const years = await tx.fiscalYear.findMany({
      where: { companyId: actor.companyId },
      include: { periods: { orderBy: { periodNumber: "asc" } } },
      orderBy: { startDate: "desc" },
    });
    return years.map((year) => ({
      id: year.id,
      start: fromDbDate(year.startDate),
      end: fromDbDate(year.endDate),
      status: year.status,
      closedAt: year.closedAt,
      periods: year.periods.map((period) => ({
        id: period.id,
        number: period.periodNumber,
        start: fromDbDate(period.startDate),
        end: fromDbDate(period.endDate),
        status: period.status,
        lockedAt: period.lockedAt,
      })),
    }));
  });
}

/**
 * Creates a fiscal year with its monthly periods: the year after the latest one, or, when `containing` is given,
 * the year that contains that date (for opening balances in the past). Years never overlap (the database refuses).
 */
export async function createFiscalYear(actor: Actor, options: { containing?: IsoDate; now?: Date } = {}): Promise<FiscalYearDto> {
  const created = await inCompany(actor, async (tx) => {
    await requireRole(tx, "fiscalYear.create");
    if (options.containing !== undefined && !isValidIsoDate(options.containing)) throw new AppError("ledger.invalidDate");
    const company = await tx.company.findUniqueOrThrow({ where: { id: actor.companyId }, select: { fiscalYearStartMonth: true } });
    let bounds;
    if (options.containing) {
      try {
        bounds = fiscalYearContaining(options.containing, company.fiscalYearStartMonth);
        // A year can be added for the past (opening balances) or for the coming year, not decades ahead: nothing deletes a year.
        const horizon = fiscalYearAfter(fiscalYearContaining(todayIso(options.now), company.fiscalYearStartMonth).end).end;
        if (bounds.start > horizon) throw new AppError("ledger.dateTooFar");
      } catch (error) {
        if (error instanceof RangeError) throw new AppError("ledger.invalidDate"); // the calendar's own limits (years 1900 to 2999)
        throw error;
      }
    } else {
      const latest = await tx.fiscalYear.findFirst({ where: { companyId: actor.companyId }, orderBy: { endDate: "desc" }, select: { endDate: true } });
      bounds = latest ? fiscalYearAfter(fromDbDate(latest.endDate)) : fiscalYearContaining(todayIso(options.now), company.fiscalYearStartMonth);
    }
    const overlapping = await tx.fiscalYear.findFirst({
      where: { companyId: actor.companyId, startDate: { lte: toDbDate(bounds.end) }, endDate: { gte: toDbDate(bounds.start) } },
      select: { id: true },
    });
    if (overlapping) throw new AppError("ledger.fiscalYearExists");
    let year;
    try {
      year = await tx.fiscalYear.create({ data: { companyId: actor.companyId, startDate: toDbDate(bounds.start), endDate: toDbDate(bounds.end) } });
    } catch (error) {
      // A double click: both requests compute the same dates and the database lets only one through.
      if (isConflict(error)) throw new AppError("ledger.fiscalYearExists");
      throw error;
    }
    await tx.fiscalPeriod.createMany({
      data: monthlyPeriods(bounds).map((period) => ({
        companyId: actor.companyId,
        fiscalYearId: year.id,
        periodNumber: period.number,
        startDate: toDbDate(period.start),
        endDate: toDbDate(period.end),
      })),
    });
    return year.id;
  });
  const year = (await listFiscalYears(actor)).find((candidate) => candidate.id === created);
  if (!year) throw new AppError("ledger.fiscalYearNotFound");
  return year;
}

/** Locks a period: no entry can be dated in it any more. */
export async function lockPeriod(actor: Actor, periodId: string): Promise<void> {
  await inCompany(actor, async (tx) => {
    await requireRole(tx, "period.lock");
    const period = await tx.fiscalPeriod.findFirst({ where: { companyId: actor.companyId, id: periodId }, select: { status: true } });
    if (!period) throw new AppError("ledger.periodNotFound");
    if (period.status === "LOCKED") return;
    await tx.fiscalPeriod.update({
      where: { companyId_id: { companyId: actor.companyId, id: periodId } },
      data: { status: "LOCKED", lockedAt: new Date(), lockedById: actor.userId },
    });
  });
}

/** The proof that the owner is there right now: a fresh code of their authenticator (or a recovery code). */
export type ReopenProof = { code: string; now?: Date };

/**
 * Reopening the past is privileged: owner only, two-factor authentication turned on and a code typed now (a session
 * cookie alone is not enough), a written reason, and an audit event on top of the automatic audit of the change itself.
 * A TOTP code works once: reopening two periods in a row takes two codes.
 *
 * The cheap checks come first (reason, 2FA on, the target exists and needs reopening) and the code last, right before the
 * change: a code is spent only by a reopening that is going to happen, not by a stale form or a mistyped target.
 */
async function requireReopenRequest(actor: Actor, reason: string): Promise<string> {
  const parsed = reasonSchema.safeParse(reason);
  if (!parsed.success) throw new AppError("ledger.reasonRequired");
  if (!(await totpStatus(actor.userId)).enabled) throw new AppError("ledger.twoFactorRequired");
  return parsed.data;
}

async function requireFreshCode(actor: Actor, proof: ReopenProof): Promise<void> {
  const verdict = await verifySecondFactor(actor.userId, proof.code, proof.now);
  if (verdict === "rate_limited") throw new AppError("ledger.rateLimited");
  if (verdict !== "ok") throw new AppError("ledger.codeInvalid");
}

export async function reopenPeriod(actor: Actor, periodId: string, reason: string, proof: ReopenProof): Promise<void> {
  await inCompany(actor, async (tx) => {
    await requireRole(tx, "period.reopen");
    const why = await requireReopenRequest(actor, reason);
    const period = await tx.fiscalPeriod.findFirst({
      where: { companyId: actor.companyId, id: periodId },
      select: { status: true, periodNumber: true, fiscalYear: { select: { status: true } } },
    });
    if (!period) throw new AppError("ledger.periodNotFound");
    if (period.status === "OPEN") return;
    if (period.fiscalYear.status === "CLOSED") throw new AppError("AL003"); // the year is reopened first (the database says so too)
    await requireFreshCode(actor, proof);
    await tx.fiscalPeriod.update({
      where: { companyId_id: { companyId: actor.companyId, id: periodId } },
      data: { status: "OPEN", lockedAt: null, lockedById: null },
    });
    await recordEvent(tx, { action: "period.reopen", entityType: "fiscal_period", entityId: periodId, data: { reason: why, periodNumber: period.periodNumber } });
  });
}

/** Closes a fiscal year; the database requires every one of its periods to be locked and to cover the year. */
export async function closeFiscalYear(actor: Actor, yearId: string): Promise<void> {
  await inCompany(actor, async (tx) => {
    await requireRole(tx, "fiscalYear.close");
    const year = await tx.fiscalYear.findFirst({ where: { companyId: actor.companyId, id: yearId }, select: { status: true } });
    if (!year) throw new AppError("ledger.fiscalYearNotFound");
    if (year.status === "CLOSED") return;
    await tx.fiscalYear.update({
      where: { companyId_id: { companyId: actor.companyId, id: yearId } },
      data: { status: "CLOSED", closedAt: new Date(), closedById: actor.userId },
    });
    await recordEvent(tx, { action: "fiscal_year.close", entityType: "fiscal_year", entityId: yearId });
  });
}

export async function reopenFiscalYear(actor: Actor, yearId: string, reason: string, proof: ReopenProof): Promise<void> {
  await inCompany(actor, async (tx) => {
    await requireRole(tx, "fiscalYear.reopen");
    const why = await requireReopenRequest(actor, reason);
    const year = await tx.fiscalYear.findFirst({ where: { companyId: actor.companyId, id: yearId }, select: { status: true } });
    if (!year) throw new AppError("ledger.fiscalYearNotFound");
    if (year.status === "OPEN") return;
    await requireFreshCode(actor, proof);
    await tx.fiscalYear.update({
      where: { companyId_id: { companyId: actor.companyId, id: yearId } },
      data: { status: "OPEN", closedAt: null, closedById: null },
    });
    await recordEvent(tx, { action: "fiscal_year.reopen", entityType: "fiscal_year", entityId: yearId, data: { reason: why } });
  });
}
