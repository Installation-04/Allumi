"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/app/_lib/session";
import { safeAction } from "@/app/_lib/safe-action";
import { textValues, type FormState } from "@/app/_lib/form-state";
import { AppError } from "@/platform/errors";
import { saveCreditDraft, deleteCreditDraft } from "@/modules/purchases";
export async function saveCreditAction(companyId: string, billId: string, id: string | null, _previous: FormState, form: FormData): Promise<FormState> {
  const amountNames = [...form.keys()].filter(key => key.startsWith("amount-"));
  const values = textValues(form, ["documentDate", "memo", "revision", ...amountNames]);
  return safeAction(async () => {
    const session = await requireSession();
    const lines = amountNames.map(name => ({ lineId: name.slice(7), amount: values[name] ?? "" }));
    const creditId = await saveCreditDraft({ userId: session.userId, companyId }, billId, { ...values, lines }, id ?? undefined);
    revalidatePath(`/c/${companyId}`, "layout");
    redirect(`/c/${companyId}/credits-fournisseurs/${creditId}`);
  }, values);
}
export async function deleteCreditAction(companyId: string, id: string, revision: string, _previous: FormState, form: FormData): Promise<FormState> {
  return safeAction(async () => {
    if (form.get("confirm") !== "yes") throw new AppError("purchases.confirm");
    const session = await requireSession();
    await deleteCreditDraft({ userId: session.userId, companyId }, id, revision);
    revalidatePath(`/c/${companyId}`, "layout");
    redirect(`/c/${companyId}/credits-fournisseurs`);
  });
}
