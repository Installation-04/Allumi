"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/app/_lib/session";
import { safeAction } from "@/app/_lib/safe-action";
import { textValues, type FormState } from "@/app/_lib/form-state";
import { AppError } from "@/platform/errors";
import { saveEstimate, transitionEstimate, convertEstimate, deleteEstimate } from "@/modules/sales";
export async function saveEstimateAction(companyId: string, id: string | null, _previous: FormState, form: FormData): Promise<FormState> {
  const values = textValues(form, ["contactId", "issueDate", "dueDate", "reference", "memo", "terms", "revision", "lines"]);
  return safeAction(async () => {
    let lines: unknown;
    try { lines = JSON.parse(values.lines ?? ""); } catch { throw new AppError("estimates.invalid"); }
    const session = await requireSession();
    const estimateId = await saveEstimate({ userId: session.userId, companyId }, { ...values, lines }, id ?? undefined);
    revalidatePath(`/c/${companyId}`, "layout");
    redirect(`/c/${companyId}/devis/${estimateId}`);
  }, values);
}
export async function transitionEstimateAction(companyId: string, id: string, revision: string, status: "SENT" | "ACCEPTED" | "DECLINED" | "CANCELLED", _previous: FormState, form: FormData): Promise<FormState> {
  const values = textValues(form, ["note"]);
  return safeAction(async () => {
    if (form.get("confirm") !== "yes") throw new AppError("estimates.confirm");
    const session = await requireSession();
    await transitionEstimate({ userId: session.userId, companyId }, id, revision, status, values.note ?? "");
    revalidatePath(`/c/${companyId}`, "layout");
  }, values);
}
export async function convertEstimateAction(companyId: string, id: string, revision: string, _previous: FormState, form: FormData): Promise<FormState> {
  const values = textValues(form, ["issueDate", "dueDate"]);
  return safeAction(async () => {
    if (form.get("confirm") !== "yes") throw new AppError("estimates.confirm");
    const session = await requireSession();
    const invoiceId = await convertEstimate({ userId: session.userId, companyId }, id, revision, values.issueDate ?? "", values.dueDate ?? "");
    revalidatePath(`/c/${companyId}`, "layout");
    redirect(`/c/${companyId}/factures/${invoiceId}`);
  }, values);
}
export async function deleteEstimateAction(companyId: string, id: string, revision: string, _previous: FormState, form: FormData): Promise<FormState> {
  return safeAction(async () => {
    if (form.get("confirm") !== "yes") throw new AppError("estimates.confirm");
    const session = await requireSession();
    await deleteEstimate({ userId: session.userId, companyId }, id, revision);
    revalidatePath(`/c/${companyId}`, "layout");
    redirect(`/c/${companyId}/devis`);
  });
}
