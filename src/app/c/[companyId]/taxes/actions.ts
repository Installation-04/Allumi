"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/app/_lib/session";
import { safeAction } from "@/app/_lib/safe-action";
import { textValues, type FormState } from "@/app/_lib/form-state";
import { createTax, createTaxCode, scheduleRate, saveItem, archiveCatalog } from "@/modules/taxes";

export async function configureAction(companyId: string, kind: "tax" | "rate" | "code", _previous: FormState, form: FormData): Promise<FormState> {
  const values = textValues(form, ["code", "nameFr", "nameEn", "payableAccountId", "recoverableAccountId", "percent", "from", "taxId", "treatment", "tax1", "tax2"]);
  return safeAction(async () => {
    const session = await requireSession();
    const actor = { userId: session.userId, companyId };
    if (kind === "tax") await createTax(actor, values);
    else if (kind === "rate") await scheduleRate(actor, values);
    else await createTaxCode(actor, { ...values, taxIds: [values.tax1, values.tax2].filter(Boolean) });
    revalidatePath(`/c/${companyId}`, "layout");
    redirect(`/c/${companyId}/taxes`);
  }, values);
}
export async function saveItemAction(companyId: string, id: string | null, _previous: FormState, form: FormData): Promise<FormState> {
  const values = textValues(form, ["code", "name", "description", "unitPrice", "incomeAccountId", "expenseAccountId", "defaultTaxCodeId"]);
  return safeAction(async () => {
    const session = await requireSession();
    const itemId = await saveItem({ userId: session.userId, companyId }, values, id ?? undefined);
    revalidatePath(`/c/${companyId}`, "layout");
    redirect(`/c/${companyId}/catalogue/${itemId}`);
  }, values);
}
export async function archiveAction(companyId: string, kind: "item" | "taxCode", id: string, active: boolean, _previous: FormState, _form: FormData): Promise<FormState> {
  return safeAction(async () => {
    const session = await requireSession();
    await archiveCatalog({ userId: session.userId, companyId }, kind, id, active);
    revalidatePath(`/c/${companyId}`, "layout");
    return undefined;
  });
}
