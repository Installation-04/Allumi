"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/app/_lib/session";
import { safeAction } from "@/app/_lib/safe-action";
import { textValues, type FormState } from "@/app/_lib/form-state";
import { forecastFilters } from "@/app/_lib/cash-forecast";
import { createForecastPreset, deleteForecastPreset, forecastPresetQuery } from "@/modules/reports";
import { todayIso } from "@/modules/ledger";
import { AppError } from "@/platform/errors";

function unique(form: FormData, names: string[]) {
  if (names.some(n => form.getAll(n).length !== 1 || typeof form.get(n) !== "string")) throw new AppError("reports.presetInvalid");
}
export async function createAction(companyId: string, asOf: string, _previous: FormState, form: FormData): Promise<FormState> {
  const names = ["name", "days", "receiptDelay", "paymentDelay"], values = textValues(form, names);
  return safeAction(async () => {
    unique(form, names);
    const { userId } = await requireSession();
    const filters = forecastFilters({ date: asOf, jours: values.days, delai_clients: values.receiptDelay, delai_fournisseurs: values.paymentDelay }, todayIso());
    await createForecastPreset({ userId, companyId }, { name: values.name ?? "", ...filters });
    revalidatePath(`/c/${companyId}/previsions-tresorerie/configurations`);
    redirect(`/c/${companyId}/previsions-tresorerie/configurations?${forecastPresetQuery(filters, asOf)}`);
  }, values);
}
export async function deleteAction(companyId: string, id: string, _previous: FormState, form: FormData): Promise<FormState> {
  return safeAction(async () => {
    const { userId } = await requireSession();
    if (form.getAll("confirmed").length !== 1 || form.get("confirmed") !== "yes") throw new AppError("reports.presetConfirm");
    await deleteForecastPreset({ userId, companyId }, id, true);
    revalidatePath(`/c/${companyId}/previsions-tresorerie/configurations`);
    return { notice: "saved" };
  });
}
