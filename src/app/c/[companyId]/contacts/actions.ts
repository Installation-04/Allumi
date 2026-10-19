"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/app/_lib/session";
import { safeAction } from "@/app/_lib/safe-action";
import type { FormState } from "@/app/_lib/form-state";
import { saveContact, setContactActive } from "@/modules/contacts";

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
