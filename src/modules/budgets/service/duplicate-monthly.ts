import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { recordEvent } from "@/modules/audit";
import { requireRole } from "@/modules/companies";
import { AppError, isConflict } from "@/platform/errors";
import { withCompany, type CompanyContext, type Tx } from "@/platform/tenant";
import { budgetInput, MAX_BUDGET_ACCOUNTS } from "../domain/budget";
import { allocationSummary } from "../domain/monthly";

const uuid = z.uuid();
const inputSchema = budgetInput.extend({
  sourceRevision: z.number().int().positive().max(2147483647),
  stateToken: z.string().regex(/^[a-f0-9]{64}$/),
  skipInactive: z.boolean(),
  confirmed: z.literal(true),
}).strict();
type Period = { id: string; number: number; from: string; to: string };
type Header = { id: string; name: string; revision: number; fiscalYearId: string; from: string; to: string };
type Year = { id: string; from: string; to: string };
type RawTarget = { accountId: string; code: string; nameFr: string; nameEn: string; type: "REVENUE" | "EXPENSE"; isActive: boolean; amountCents: string; months: { periodId: string; number: number; amountCents: string }[] };
type Snapshot = { source: Header; destination: Year | null; sourcePeriods: Period[]; destinationPeriods: Period[]; destinationCoverage: number; targets: RawTarget[] };

function validPeriods(periods: Period[]) {
  return periods.length === 12 && new Set(periods.map(p => p.id)).size === 12 && periods.every((p, i) => p.number === i + 1);
}
/** One SQL snapshot, bounded to 1,001 accounts and 13 periods/targets per account for validation. */
async function readPreview(tx: Tx, actor: CompanyContext, sourceId: string, yearId: string | null) {
  const [raw] = await tx.$queryRaw<Snapshot[]>`
    SELECT jsonb_build_object('id',b.id,'name',b.name,'revision',b.revision,'fiscalYearId',f.id,'from',to_char(f.start_date,'YYYY-MM-DD'),'to',to_char(f.end_date,'YYYY-MM-DD')) AS source,
    CASE WHEN d.id IS NULL THEN NULL ELSE jsonb_build_object('id',d.id,'from',to_char(d.start_date,'YYYY-MM-DD'),'to',to_char(d.end_date,'YYYY-MM-DD')) END AS destination,
    coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'number',p.period_number,'from',to_char(p.start_date,'YYYY-MM-DD'),'to',to_char(p.end_date,'YYYY-MM-DD')) ORDER BY p.period_number)
      FROM (SELECT * FROM fiscal_period WHERE company_id=b.company_id AND fiscal_year_id=f.id ORDER BY period_number LIMIT 13) p),'[]'::jsonb) AS "sourcePeriods",
    coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'number',p.period_number,'from',to_char(p.start_date,'YYYY-MM-DD'),'to',to_char(p.end_date,'YYYY-MM-DD')) ORDER BY p.period_number)
      FROM (SELECT * FROM fiscal_period WHERE company_id=b.company_id AND fiscal_year_id=d.id ORDER BY period_number LIMIT 13) p),'[]'::jsonb) AS "destinationPeriods",
    (SELECT count(*)::int FROM (
      SELECT l.account_id FROM budget_line l JOIN account a ON a.company_id=l.company_id AND a.id=l.account_id
      WHERE l.company_id=b.company_id AND l.budget_id=b.id AND a.is_active
      UNION SELECT j.account_id FROM journal_line j JOIN account a ON a.company_id=j.company_id AND a.id=j.account_id
      WHERE j.company_id=b.company_id AND a.type IN ('REVENUE','EXPENSE') AND j.entry_date BETWEEN d.start_date AND d.end_date
      LIMIT ${MAX_BUDGET_ACCOUNTS + 1}
    ) present) AS "destinationCoverage",
    coalesce((SELECT jsonb_agg(r ORDER BY r."accountId") FROM (
      SELECT a.id AS "accountId",a.code,a.name_fr AS "nameFr",a.name_en AS "nameEn",a.type,a.is_active AS "isActive",l.amount_cents::text AS "amountCents",
        coalesce((SELECT jsonb_agg(m ORDER BY m.number) FROM (
          SELECT p.id AS "periodId",p.period_number AS number,t.amount_cents::text AS "amountCents"
          FROM budget_monthly_target t JOIN fiscal_period p ON p.company_id=t.company_id AND p.id=t.fiscal_period_id
          WHERE t.company_id=l.company_id AND t.budget_line_id=l.id ORDER BY p.period_number LIMIT 13
        ) m),'[]'::jsonb) AS months
      FROM budget_line l JOIN account a ON a.company_id=l.company_id AND a.id=l.account_id
      WHERE l.company_id=b.company_id AND l.budget_id=b.id ORDER BY a.id LIMIT ${MAX_BUDGET_ACCOUNTS + 1}
    ) r),'[]'::jsonb) AS targets
    FROM budget b JOIN fiscal_year f ON f.company_id=b.company_id AND f.id=b.fiscal_year_id
    LEFT JOIN fiscal_year d ON d.company_id=b.company_id AND d.id=${yearId}::uuid
    WHERE b.company_id=${actor.companyId}::uuid AND b.id=${sourceId}::uuid`;
  if (!raw) throw new AppError("budgets.notFound");
  if (yearId && !raw.destination) throw new AppError("budgets.year");
  if (raw.targets.length > MAX_BUDGET_ACCOUNTS || (raw.destination && raw.destinationCoverage > MAX_BUDGET_ACCOUNTS)) throw new AppError("budgets.tooMany");
  if (!validPeriods(raw.sourcePeriods) || (raw.destination && !validPeriods(raw.destinationPeriods))) throw new AppError("budgets.monthlyPeriods");
  const targets = raw.targets.map(row => {
    if (!["REVENUE", "EXPENSE"].includes(row.type)) throw new AppError("budgets.account");
    if (row.months.length > 12 || new Set(row.months.map(m => m.periodId)).size !== row.months.length || row.months.some(m => !raw.sourcePeriods.some(p => p.id === m.periodId && p.number === m.number))) throw new AppError("budgets.monthlyPeriods");
    const amountCents = BigInt(row.amountCents), months = row.months.map(m => ({ ...m, amountCents: BigInt(m.amountCents) }));
    const allocation = allocationSummary(amountCents,raw.sourcePeriods.map(p => months.find(m => m.periodId === p.id)?.amountCents ?? null));
    if (allocation.remainingCents < 0n || months.some(m => m.amountCents < 0n)) throw new AppError("budgets.monthlyExcess");
    return { ...row, amountCents, months, ...allocation };
  });
  const periodState = (periods: Period[]) => periods.map(p => [p.id, p.number, p.from, p.to]);
  const stateToken = createHash("sha256").update(JSON.stringify([
    actor.companyId, actor.userId, raw.source.id, raw.source.name, raw.source.revision, raw.source.fiscalYearId, raw.source.from, raw.source.to,
    raw.destination ? [raw.destination.id, raw.destination.from, raw.destination.to] : null,
    periodState(raw.sourcePeriods), periodState(raw.destinationPeriods),
    raw.targets.map(r => [r.accountId,r.code,r.nameFr,r.nameEn,r.type,r.isActive,r.amountCents,r.months.map(m => [m.periodId,m.number,m.amountCents])]),
  ])).digest("hex");
  const active = targets.filter(r => r.isActive), inactive = targets.filter(r => !r.isActive);
  const sum = (type: RawTarget["type"], monthly: boolean) => active.filter(r => r.type === type).reduce((s, r) => s + (monthly ? r.allocatedCents : r.amountCents), 0n);
  return { source: raw.source, destination: raw.destination, targets, stateToken,
    mapping: raw.destination ? raw.sourcePeriods.map((source, i) => ({ number: source.number, source, destination: raw.destinationPeriods[i]! })) : [],
    activeCount: active.length, inactiveCount: inactive.length,
    monthlyCount: active.reduce((n,r) => n+r.months.length,0), excludedMonthlyCount: inactive.reduce((n,r) => n+r.months.length,0),
    annualRevenueCents: sum("REVENUE",false), annualExpenseCents: sum("EXPENSE",false), monthlyRevenueCents: sum("REVENUE",true), monthlyExpenseCents: sum("EXPENSE",true),
  };
}
export async function getMonthlyBudgetCopyPreview(actor: CompanyContext, sourceId: string, yearId?: string) {
  if (!uuid.safeParse(sourceId).success || (yearId !== undefined && !uuid.safeParse(yearId).success)) throw new AppError("budgets.invalid");
  return withCompany(actor, async tx => { await requireRole(tx,"budget.manage"); return readPreview(tx,actor,sourceId,yearId ?? null); });
}
export type MonthlyBudgetCopyPreview = Awaited<ReturnType<typeof getMonthlyBudgetCopyPreview>>;

/** Copy planned amounts by fiscal period number; source, references, annual/monthly writes and audit are atomic. */
export async function duplicateMonthlyBudget(actor: CompanyContext, sourceId: string, input: z.input<typeof inputSchema>): Promise<{ id: string; firstPeriodId: string }> {
  const parsed = inputSchema.safeParse(input);
  if (!uuid.safeParse(sourceId).success || !parsed.success) throw new AppError("budgets.invalid");
  const data = parsed.data;
  try { return await withCompany(actor, async tx => {
    await requireRole(tx,"budget.manage");
    const [source] = await tx.$queryRaw<{ revision: number; fiscal_year_id: string }[]>`SELECT revision,fiscal_year_id FROM budget WHERE company_id=${actor.companyId}::uuid AND id=${sourceId}::uuid FOR UPDATE`;
    if (!source) throw new AppError("budgets.notFound");
    if (source.revision !== data.sourceRevision) throw new AppError("budgets.copyStale");
    await tx.$queryRaw`SELECT a.id FROM account a JOIN budget_line l ON l.company_id=a.company_id AND l.account_id=a.id WHERE l.company_id=${actor.companyId}::uuid AND l.budget_id=${sourceId}::uuid ORDER BY a.id LIMIT ${MAX_BUDGET_ACCOUNTS + 1} FOR SHARE OF a`;
    await tx.$queryRaw`SELECT id FROM fiscal_year WHERE company_id=${actor.companyId}::uuid AND id IN (${source.fiscal_year_id}::uuid,${data.fiscalYearId}::uuid) ORDER BY id FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM fiscal_period WHERE company_id=${actor.companyId}::uuid AND fiscal_year_id IN (${source.fiscal_year_id}::uuid,${data.fiscalYearId}::uuid) ORDER BY id FOR SHARE`;
    const fresh = await readPreview(tx,actor,sourceId,data.fiscalYearId);
    if (fresh.stateToken !== data.stateToken) throw new AppError("budgets.copyStale");
    if (fresh.inactiveCount && !data.skipInactive) throw new AppError("budgets.copyInactive");
    const destination = await tx.budget.create({ data: { companyId: actor.companyId, fiscalYearId: data.fiscalYearId, name: data.name }, select: { id: true } });
    const active = fresh.targets.filter(r => r.isActive);
    if (active.length) await tx.budgetLine.createMany({ data: active.map(r => ({ companyId: actor.companyId, budgetId: destination.id, accountId: r.accountId, amountCents: r.amountCents })) });
    const lines = await tx.budgetLine.findMany({ where: { companyId: actor.companyId, budgetId: destination.id }, select: { id: true, accountId: true } });
    if (lines.length !== active.length) throw new AppError("budgets.invalid");
    const lineIds = new Map(lines.map(l => [l.accountId,l.id]));
    const monthly = active.flatMap(r => r.months.map(m => ({ companyId: actor.companyId, budgetLineId: lineIds.get(r.accountId)!, fiscalPeriodId: fresh.mapping[m.number - 1]!.destination.id, amountCents: m.amountCents })));
    if (monthly.length) await tx.budgetMonthlyTarget.createMany({ data: monthly });
    await recordEvent(tx,{ action: "budget.duplicate_monthly", entityType: "budget", entityId: destination.id, data: {
      sourceBudgetId: sourceId, sourceRevision: source.revision, sourceFiscalYearId: source.fiscal_year_id, destinationFiscalYearId: data.fiscalYearId,
      copiedTargetCount: active.length, copiedMonthlyCount: monthly.length,
      excludedAccountIds: fresh.targets.filter(r => !r.isActive).map(r => r.accountId), excludedMonthlyCount: fresh.excludedMonthlyCount,
      periods: fresh.mapping.map(p => ({ number: p.number, sourcePeriodId: p.source.id, destinationPeriodId: p.destination.id })),
    } });
    return { id: destination.id, firstPeriodId: fresh.mapping[0]!.destination.id };
  }, "bounded-bulk"); } catch (e) { if (isConflict(e)) throw new AppError("budgets.duplicate"); throw e; }
}
