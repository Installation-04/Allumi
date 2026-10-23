"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/app/_lib/session";
import { safeAction } from "@/app/_lib/safe-action";
import { textValues, type FormState } from "@/app/_lib/form-state";
import { AppError } from "@/platform/errors";
import { saveDraft, deleteDraft } from "@/modules/sales";
export async function saveDraftAction(companyId: string, id: string | null, _previous: FormState, form: FormData): Promise<FormState> {
  const values = textValues(form, ["contactId", "issueDate", "dueDate", "reference", "memo", "revision", "lines"]);
  return safeAction(async () => {
    let lines: unknown;
    try { lines = JSON.parse(values.lines ?? ""); } catch { throw new AppError("sales.invalid"); }
    const session = await requireSession();
    const draftId = await saveDraft({ userId: session.userId, companyId }, { ...values, lines }, id ?? undefined);
    revalidatePath(`/c/${companyId}/factures`, "layout");
    redirect(`/c/${companyId}/factures/${draftId}`);
  }, values);
}
export async function deleteDraftAction(companyId: string, id: string, revision: string, _previous: FormState, form: FormData): Promise<FormState> {
  return safeAction(async () => {
    if (form.get("confirm") !== "yes") throw new AppError("sales.confirm");
    const session = await requireSession();
    await deleteDraft({ userId: session.userId, companyId }, id, revision);
    revalidatePath(`/c/${companyId}/factures`, "layout");
    redirect(`/c/${companyId}/factures`);
  });
}
export async function postInvoiceAction(companyId: string, id: string, revision: string, _previous: FormState, form: FormData): Promise<FormState> {
  const values = textValues(form, ["postingDate"]);
  return safeAction(async () => {
    if (form.get("confirm") !== "yes") throw new AppError("sales.confirmPost");
    const session = await requireSession();
    const { postInvoice } = await import("@/modules/sales");
    await postInvoice({ userId: session.userId, companyId }, id, revision, values.postingDate ?? "");
    revalidatePath(`/c/${companyId}`, "layout");
    redirect(`/c/${companyId}/factures/validees/${id}`);
  }, values);
}
