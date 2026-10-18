"use server";

import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { requireSession } from "@/app/_lib/session";
import { safeAction } from "@/app/_lib/safe-action";
import { listValues, textValues, type FormState } from "@/app/_lib/form-state";
import { AppError } from "@/platform/errors";
import type { Locale } from "@/modules/ledger";
import { addTaxRate, createTax, createTaxCode, installQuebecTaxes, parsePercent, updateTax, updateTaxCode, type TaxInput } from "@/modules/taxes";

async function localeOf(): Promise<Locale> {
  return (await getLocale()) === "en" ? "en" : "fr-CA";
}

/** A percentage typed in a box -> millionths, or a refusal that says what is expected. */
function rate(text: string, locale: Locale): bigint {
  const parsed = parsePercent(text, locale);
  if (parsed === null) throw new AppError("taxes.invalidRate");
  return parsed;
}

export async function installTaxesAction(companyId: string, _previous: FormState, _formData: FormData): Promise<FormState> {
  return safeAction(async () => {
    const session = await requireSession();
    await installQuebecTaxes({ userId: session.userId, companyId });
    revalidatePath(`/c/${companyId}/taxes`);
    return undefined;
  });
}

export async function createTaxAction(companyId: string, _previous: FormState, formData: FormData): Promise<FormState> {
  const values = textValues(formData, ["code", "nameFr", "nameEn", "rate", "from", "registrationNumber", "recoverable"]);
  return safeAction(async () => {
    const session = await requireSession();
    const locale = await localeOf();
    const input: TaxInput = {
      code: values.code ?? "",
      nameFr: values.nameFr ?? "",
      nameEn: values.nameEn ?? "",
      registrationNumber: values.registrationNumber,
      rateMicro: rate(values.rate ?? "", locale),
      from: values.from ?? "",
      recoverable: values.recoverable === "on",
    };
    await createTax({ userId: session.userId, companyId }, input);
    revalidatePath(`/c/${companyId}/taxes`);
    return { notice: "created" };
  }, values);
}

export async function addRateAction(companyId: string, taxId: string, _previous: FormState, formData: FormData): Promise<FormState> {
  const values = textValues(formData, ["rate", "from"]);
  return safeAction(async () => {
    const session = await requireSession();
    const locale = await localeOf();
    await addTaxRate({ userId: session.userId, companyId }, taxId, { rateMicro: rate(values.rate ?? "", locale), from: values.from ?? "" });
    revalidatePath(`/c/${companyId}/taxes`);
    return { notice: "saved" };
  }, values);
}

export async function setTaxActiveAction(companyId: string, taxId: string, active: boolean, _previous: FormState, _formData: FormData): Promise<FormState> {
  return safeAction(async () => {
    const session = await requireSession();
    await updateTax({ userId: session.userId, companyId }, taxId, { isActive: active });
    revalidatePath(`/c/${companyId}/taxes`);
    return undefined;
  });
}

export async function createTaxCodeAction(companyId: string, _previous: FormState, formData: FormData): Promise<FormState> {
  const values = { ...textValues(formData, ["code", "nameFr", "nameEn", "treatment"]), ...listValues(formData, "taxIds") };
  return safeAction(async () => {
    const session = await requireSession();
    await createTaxCode(
      { userId: session.userId, companyId },
      { code: values.code ?? "", nameFr: values.nameFr ?? "", nameEn: values.nameEn ?? "", treatment: values.treatment as "STANDARD", taxIds: (values.taxIds ?? "").split(",").filter(Boolean) },
    );
    revalidatePath(`/c/${companyId}/taxes`);
    return { notice: "created" };
  }, values);
}

export async function setTaxCodeActiveAction(companyId: string, taxCodeId: string, active: boolean, _previous: FormState, _formData: FormData): Promise<FormState> {
  return safeAction(async () => {
    const session = await requireSession();
    await updateTaxCode({ userId: session.userId, companyId }, taxCodeId, { isActive: active });
    revalidatePath(`/c/${companyId}/taxes`);
    return undefined;
  });
}
