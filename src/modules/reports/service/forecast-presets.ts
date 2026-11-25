import "server-only";
import { requireRole } from "@/modules/companies";
import { AppError, isConflict } from "@/platform/errors";
import { withCompany, type CompanyContext } from "@/platform/tenant";
import { forecastPresetInput, MAX_FORECAST_PRESETS, type ForecastPresetInput } from "../domain/forecast-presets";

const select = { id: true, name: true, days: true, receiptDelay: true, paymentDelay: true } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function listForecastPresets(actor: CompanyContext) {
  return withCompany(actor, async tx => {
    await requireRole(tx, "ledger.read"); await requireRole(tx, "sales.read");
    const rows = await tx.cashForecastPreset.findMany({ where: { companyId: actor.companyId }, select, orderBy: [{ name: "asc" }, { id: "asc" }], take: MAX_FORECAST_PRESETS + 1 });
    if (rows.length > MAX_FORECAST_PRESETS) throw new AppError("reports.presetLimit");
    return rows;
  });
}
export async function createForecastPreset(actor: CompanyContext, input: ForecastPresetInput) {
  const parsed = forecastPresetInput.safeParse(input);
  if (!parsed.success) throw new AppError("reports.presetInvalid");
  return withCompany(actor, async tx => {
    await requireRole(tx, "budget.manage"); await requireRole(tx, "sales.read");
    // Shared with the SQL trigger: serialize capacity checks even for concurrent/direct writes.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('cash_forecast_preset:' || ${actor.companyId}::text, 0))`;
    if (await tx.cashForecastPreset.findFirst({ where: { companyId: actor.companyId, name: parsed.data.name }, select: { id: true } })) throw new AppError("reports.presetDuplicate");
    if (await tx.cashForecastPreset.count({ where: { companyId: actor.companyId } }) >= MAX_FORECAST_PRESETS) throw new AppError("reports.presetLimit");
    try { return (await tx.cashForecastPreset.create({ data: { companyId: actor.companyId, ...parsed.data }, select: { id: true } })).id; }
    catch (e) { if (isConflict(e)) throw new AppError("reports.presetDuplicate"); throw e; }
  });
}
export async function deleteForecastPreset(actor: CompanyContext, id: string, confirmed: boolean) {
  if (confirmed !== true) throw new AppError("reports.presetConfirm");
  if (!UUID.test(id)) throw new AppError("reports.presetNotFound");
  return withCompany(actor, async tx => {
    await requireRole(tx, "budget.manage"); await requireRole(tx, "sales.read");
    if ((await tx.cashForecastPreset.deleteMany({ where: { companyId: actor.companyId, id } })).count !== 1) throw new AppError("reports.presetNotFound");
  });
}
