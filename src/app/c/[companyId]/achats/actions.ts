"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/app/_lib/session";
import { safeAction } from "@/app/_lib/safe-action";
import { textValues, type FormState } from "@/app/_lib/form-state";
import { AppError } from "@/platform/errors";
import { saveDraft, deleteDraft } from "@/modules/purchases";
export async function saveDraftAction(companyId: string, id: string | null, _previous: FormState, form: FormData): Promise<FormState> {
  const values = textValues(form, ["contactId", "documentDate", "dueDate", "supplierReference", "memo", "revision", "lines"]);
  return safeAction(async () => {
    let lines: unknown;
    try { lines = JSON.parse(values.lines ?? ""); } catch { throw new AppError("purchases.invalid"); }
    const session = await requireSession();
    const draftId = await saveDraft({ userId: session.userId, companyId }, { ...values, lines }, id ?? undefined);
    revalidatePath(`/c/${companyId}/achats`, "layout");
    redirect(`/c/${companyId}/achats/${draftId}`);
  }, values);
}
export async function deleteDraftAction(companyId: string, id: string, revision: string, _previous: FormState, form: FormData): Promise<FormState> {
  return safeAction(async () => {
    if (form.get("confirm") !== "yes") throw new AppError("purchases.confirm");
    const session = await requireSession();
    await deleteDraft({ userId: session.userId, companyId }, id, revision);
    revalidatePath(`/c/${companyId}/achats`, "layout");
    redirect(`/c/${companyId}/achats`);
  });
}
export async function postBillAction(companyId: string, id: string, revision: string, _previous: FormState, form: FormData): Promise<FormState> {
  const values = textValues(form, ["postingDate"]);
  return safeAction(async () => {
    if (form.get("confirm") !== "yes") throw new AppError("purchases.confirmPost");
    const session = await requireSession();
    const { postBill } = await import("@/modules/purchases");
    await postBill({ userId: session.userId, companyId }, id, revision, values.postingDate ?? "");
    revalidatePath(`/c/${companyId}`, "layout");
    redirect(`/c/${companyId}/achats/validees/${id}`);
  }, values);
}
export async function voidBillAction(companyId: string, id: string, _previous: FormState, form: FormData): Promise<FormState> {
  const values = textValues(form, ["voidDate", "reason"]);
  return safeAction(async () => {
    if (form.get("confirm") !== "yes") throw new AppError("purchases.confirmVoid");
    const session = await requireSession();
    const { voidBill } = await import("@/modules/purchases");
    await voidBill({ userId: session.userId, companyId }, id, values.voidDate ?? "", values.reason ?? "");
    revalidatePath(`/c/${companyId}`, "layout");
    redirect(`/c/${companyId}/achats/validees/${id}`);
  }, values);
}
