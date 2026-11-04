"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { requireSession } from "@/app/_lib/session";
import { safeAction } from "@/app/_lib/safe-action";
import { textValues, type FormState } from "@/app/_lib/form-state";
import { AppError } from "@/platform/errors";
import { parseMoney } from "@/modules/ledger";
import { applyCustomerCredit, unapplyCustomerCredit } from "@/modules/sales";

// Expected balances come from the server-rendered review, never editable fields.
export async function applyCreditAction(companyId: string, creditNoteId: string, invoiceId: string, expectedCreditCents: string, expectedInvoiceCents: string, _previous: FormState, form: FormData): Promise<FormState> {
  const values = textValues(form, ["amount", "date"]);
  return safeAction(async () => {
    if (form.get("confirm") !== "yes") throw new AppError("salesApplications.confirm");
    const session = await requireSession();
    const cents = parseMoney(values.amount ?? "", (await getLocale()) === "en" ? "en" : "fr-CA");
    if (cents === null || cents <= 0n) throw new AppError("salesApplications.invalid");
    await applyCustomerCredit({ userId: session.userId, companyId }, { creditNoteId, invoiceId, amountCents: String(cents), expectedCreditCents, expectedInvoiceCents, date: values.date });
    revalidatePath(`/c/${companyId}`, "layout");
    redirect(`/c/${companyId}/avoirs/valides/${creditNoteId}`);
  }, values);
}

export async function unapplyCreditAction(companyId: string, creditNoteId: string, applicationId: string, _previous: FormState, form: FormData): Promise<FormState> {
  const values = textValues(form, ["date"]);
  return safeAction(async () => {
    if (form.get("confirm") !== "yes") throw new AppError("salesApplications.confirm");
    const session = await requireSession();
    await unapplyCustomerCredit({ userId: session.userId, companyId }, applicationId, { date: values.date });
    revalidatePath(`/c/${companyId}`, "layout");
    redirect(`/c/${companyId}/avoirs/valides/${creditNoteId}`);
  }, values);
}
