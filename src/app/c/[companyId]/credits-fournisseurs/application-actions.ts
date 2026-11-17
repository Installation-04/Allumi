"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getLocale } from "@/platform/i18n/server";
import { requireSession } from "@/app/_lib/session";
import { safeAction } from "@/app/_lib/safe-action";
import { textValues, type FormState } from "@/app/_lib/form-state";
import { AppError } from "@/platform/errors";
import { parseMoney } from "@/modules/ledger";
import { applySupplierCredit, unapplySupplierCredit } from "@/modules/purchases";

// Expected balances come from the server-rendered review, never editable fields.
export async function applyCreditAction(companyId: string, supplierCreditId: string, billId: string, expectedCreditCents: string, expectedBillCents: string, _previous: FormState, form: FormData): Promise<FormState> {
  const values = textValues(form, ["amount", "date"]);
  return safeAction(async () => {
    if (form.get("confirm") !== "yes") throw new AppError("supplierApplications.confirm");
    const session = await requireSession();
    const cents = parseMoney(values.amount ?? "", (await getLocale()) === "en" ? "en" : "fr-CA");
    if (cents === null || cents <= 0n) throw new AppError("supplierApplications.invalid");
    await applySupplierCredit({ userId: session.userId, companyId }, { supplierCreditId, billId, amountCents: String(cents), expectedCreditCents, expectedBillCents, date: values.date });
    revalidatePath(`/c/${companyId}`, "layout");
    redirect(`/c/${companyId}/credits-fournisseurs/valides/${supplierCreditId}`);
  }, values);
}

export async function unapplyCreditAction(companyId: string, supplierCreditId: string, applicationId: string, _previous: FormState, form: FormData): Promise<FormState> {
  const values = textValues(form, ["date"]);
  return safeAction(async () => {
    if (form.get("confirm") !== "yes") throw new AppError("supplierApplications.confirm");
    const session = await requireSession();
    await unapplySupplierCredit({ userId: session.userId, companyId }, applicationId, { date: values.date });
    revalidatePath(`/c/${companyId}`, "layout");
    redirect(`/c/${companyId}/credits-fournisseurs/valides/${supplierCreditId}`);
  }, values);
}
