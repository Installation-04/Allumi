import "server-only";
import { requireRole } from "@/modules/companies";
import { recordEvent } from "@/modules/audit";
import { totpStatus } from "@/modules/auth";
import { AppError } from "@/platform/errors";
import type { IsoDate } from "../domain/dates";
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
    const company = await tx.company.findUniqueOrThrow({ where: { id: actor.companyId }, select: { fiscalYearStartMonth: true } });
    let bounds;
    if (options.containing) {
      bounds = fiscalYearContaining(options.containing, company.fiscalYearStartMonth);
    } else {
      const latest = await tx.fiscalYear.findFirst({ where: { companyId: actor.companyId }, orderBy: { endDate: "desc" }, select: { endDate: true } });
      bounds = latest ? fiscalYearAfter(fromDbDate(latest.endDate)) : fiscalYearContaining(todayIso(options.now), company.fiscalYearStartMonth);
    }
    const overlapping = await tx.fiscalYear.findFirst({
      where: { companyId: actor.companyId, startDate: { lte: toDbDate(bounds.end) }, endDate: { gte: toDbDate(bounds.start) } },
      select: { id: true },
    });
    if (overlapping) throw new AppError("ledger.fiscalYearExists");
    const year = await tx.fiscalYear.create({ data: { companyId: actor.companyId, startDate: toDbDate(bounds.start), endDate: toDbDate(bounds.end) } });
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

/**
 * Reopening the past is privileged: owner only, two-factor authentication turned on, a written reason, and an
 * audit event on top of the automatic audit of the change itself.
 */
async function requireReopenConditions(actor: Actor, reason: string): Promise<string> {
  const parsed = reasonSchema.safeParse(reason);
  if (!parsed.success) throw new AppError("ledger.reasonRequired");
  if (!(await totpStatus(actor.userId)).enabled) throw new AppError("ledger.twoFactorRequired");
  return parsed.data;
}

export async function reopenPeriod(actor: Actor, periodId: string, reason: string): Promise<void> {
  await inCompany(actor, async (tx) => {
    await requireRole(tx, "period.reopen");
    const why = await requireReopenConditions(actor, reason);
    const period = await tx.fiscalPeriod.findFirst({ where: { companyId: actor.companyId, id: periodId }, select: { status: true, periodNumber: true } });
    if (!period) throw new AppError("ledger.periodNotFound");
    if (period.status === "OPEN") return;
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

export async function reopenFiscalYear(actor: Actor, yearId: string, reason: string): Promise<void> {
  await inCompany(actor, async (tx) => {
    await requireRole(tx, "fiscalYear.reopen");
    const why = await requireReopenConditions(actor, reason);
    const year = await tx.fiscalYear.findFirst({ where: { companyId: actor.companyId, id: yearId }, select: { status: true } });
    if (!year) throw new AppError("ledger.fiscalYearNotFound");
    if (year.status === "OPEN") return;
    await tx.fiscalYear.update({
      where: { companyId_id: { companyId: actor.companyId, id: yearId } },
      data: { status: "OPEN", closedAt: null, closedById: null },
    });
    await recordEvent(tx, { action: "fiscal_year.reopen", entityType: "fiscal_year", entityId: yearId, data: { reason: why } });
  });
}
