"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { requireSession } from "@/app/_lib/session";
import { safeAction } from "@/app/_lib/safe-action";
import { textValues, type FormState } from "@/app/_lib/form-state";
import { AppError } from "@/platform/errors";
import { createItem, deleteItem, setItemActive, updateItem, type ItemInput } from "@/modules/contacts";
import type { Locale } from "@/modules/ledger";
import { parseDecimal, UNIT_PRICE_SCALE } from "@/modules/taxes";

const ITEM_FIELDS = ["code", "name", "description", "unitPrice", "incomeAccountId", "expenseAccountId", "defaultTaxCodeId"];

async function itemInput(values: Record<string, string>): Promise<ItemInput> {
  const locale: Locale = (await getLocale()) === "en" ? "en" : "fr-CA";
  const priceText = (values.unitPrice ?? "").trim();
  // a price may be negative (a discount item); an empty box means no default price
  const unitPrice = priceText === "" ? null : parseDecimal(priceText, UNIT_PRICE_SCALE, locale, true);
  if (priceText !== "" && unitPrice === null) throw new AppError("items.invalidPrice");
  return {
    code: values.code,
    name: values.name ?? "",
    description: values.description,
    unitPrice,
    incomeAccountId: values.incomeAccountId || null,
    expenseAccountId: values.expenseAccountId || null,
    defaultTaxCodeId: values.defaultTaxCodeId || null,
  };
}

export async function createItemAction(companyId: string, _previous: FormState, formData: FormData): Promise<FormState> {
  const values = textValues(formData, ITEM_FIELDS);
  return safeAction(async () => {
    const session = await requireSession();
    const created = await createItem({ userId: session.userId, companyId }, await itemInput(values));
    revalidatePath(`/c/${companyId}/produits`);
    redirect(`/c/${companyId}/produits/${created.id}`);
  }, values);
}

export async function updateItemAction(companyId: string, itemId: string, _previous: FormState, formData: FormData): Promise<FormState> {
  const values = textValues(formData, ITEM_FIELDS);
  return safeAction(async () => {
    const session = await requireSession();
    await updateItem({ userId: session.userId, companyId }, itemId, await itemInput(values));
    revalidatePath(`/c/${companyId}/produits`);
    return { notice: "saved" };
  }, values);
}

export async function setItemActiveAction(companyId: string, itemId: string, active: boolean, _previous: FormState, _formData: FormData): Promise<FormState> {
  return safeAction(async () => {
    const session = await requireSession();
    await setItemActive({ userId: session.userId, companyId }, itemId, active);
    revalidatePath(`/c/${companyId}/produits`);
    return undefined;
  });
}

export async function deleteItemAction(companyId: string, itemId: string, _previous: FormState, _formData: FormData): Promise<FormState> {
  return safeAction(async () => {
    const session = await requireSession();
    await deleteItem({ userId: session.userId, companyId }, itemId);
    revalidatePath(`/c/${companyId}/produits`);
    redirect(`/c/${companyId}/produits`);
  });
}
