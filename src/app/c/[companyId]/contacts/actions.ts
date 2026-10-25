"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/app/_lib/session";
import { safeAction } from "@/app/_lib/safe-action";
import type { FormState } from "@/app/_lib/form-state";
import { anonymizeContact, saveContact, setContactActive } from "@/modules/contacts";

export async function saveContactAction(companyId: string, contactId: string | null, _previous: FormState, formData: FormData): Promise<FormState> {
  const names = ["kind", "displayName", "legalName", "email", "phone", "addressLine1", "addressLine2", "city", "province", "postalCode", "country", "locale", "paymentTermsDays", "notes"];
  const values = Object.fromEntries(names.map((name) => [name, String(formData.get(name) ?? "")]));
  return safeAction(async () => {
    const session = await requireSession();
    const contact = await saveContact({ userId: session.userId, companyId }, { ...values, province: values.province || null, paymentTermsDays: values.paymentTermsDays?.trim() ? Number(values.paymentTermsDays) : NaN }, contactId ?? undefined);
    revalidatePath(`/c/${companyId}/contacts`, "layout");
    redirect(`/c/${companyId}/contacts/${contact.id}`);
  }, values);
}

export async function setContactActiveAction(companyId: string, contactId: string, active: boolean, _previous: FormState, _formData: FormData): Promise<FormState> {
  return safeAction(async () => {
    const session = await requireSession();
    await setContactActive({ userId: session.userId, companyId }, contactId, active);
    revalidatePath(`/c/${companyId}/contacts`, "layout");
    return undefined;
  });
}

/** Law 25 erasure. The code typed now is never sent back to the form; on success the contact no longer exists for the page, so go to the list. */
export async function anonymizeContactAction(companyId: string, contactId: string, _previous: FormState, formData: FormData): Promise<FormState> {
  const reason = String(formData.get("reason") ?? "");
  return safeAction(async () => {
    const session = await requireSession();
    await anonymizeContact({ userId: session.userId, companyId }, contactId, { reason, confirm: String(formData.get("confirm") ?? "") }, { code: String(formData.get("code") ?? "").trim() });
    revalidatePath(`/c/${companyId}/contacts`, "layout");
    revalidatePath(`/c/${companyId}/audit`);
    redirect(`/c/${companyId}/contacts?anonymized=1`);
  }, { reason });
}
