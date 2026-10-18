"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/app/_lib/session";
import { safeAction } from "@/app/_lib/safe-action";
import type { FormState } from "@/app/_lib/form-state";
import { createAccount, deleteAccount, updateAccount, type AccountInput } from "@/modules/ledger";

const field = (formData: FormData, name: string): string => String(formData.get(name) ?? "");

export async function createAccountAction(companyId: string, _previous: FormState, formData: FormData): Promise<FormState> {
  const values = Object.fromEntries(["code", "nameFr", "nameEn", "type", "subtype", "description"].map((name) => [name, field(formData, name)]));
  return safeAction(async () => {
    const session = await requireSession();
    const description = field(formData, "description").trim();
    await createAccount(
      { userId: session.userId, companyId },
      { code: values.code ?? "", nameFr: values.nameFr ?? "", nameEn: values.nameEn ?? "", type: values.type, subtype: values.subtype, description: description || null } as AccountInput,
    );
    revalidatePath(`/c/${companyId}/comptes`);
    return undefined;
  }, values);
}

/** Renames an account or changes its code or description; its type and subtype stay (they give meaning to its history). */
export async function updateAccountAction(companyId: string, accountId: string, _previous: FormState, formData: FormData): Promise<FormState> {
  const values = Object.fromEntries(["code", "nameFr", "nameEn", "description"].map((name) => [name, field(formData, name)]));
  return safeAction(async () => {
    const session = await requireSession();
    const description = field(formData, "description").trim();
    await updateAccount({ userId: session.userId, companyId }, accountId, { code: values.code ?? "", nameFr: values.nameFr ?? "", nameEn: values.nameEn ?? "", description: description || null });
    revalidatePath(`/c/${companyId}/comptes`);
    redirect(`/c/${companyId}/comptes`);
  }, values);
}

export async function setAccountActiveAction(companyId: string, accountId: string, active: boolean, _previous: FormState, _formData: FormData): Promise<FormState> {
  return safeAction(async () => {
    const session = await requireSession();
    await updateAccount({ userId: session.userId, companyId }, accountId, { isActive: active });
    revalidatePath(`/c/${companyId}/comptes`);
    return undefined;
  });
}

export async function deleteAccountAction(companyId: string, accountId: string, _previous: FormState, _formData: FormData): Promise<FormState> {
  return safeAction(async () => {
    const session = await requireSession();
    await deleteAccount({ userId: session.userId, companyId }, accountId);
    revalidatePath(`/c/${companyId}/comptes`);
    return undefined;
  });
}
