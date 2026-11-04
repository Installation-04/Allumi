"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { requireSession } from "@/app/_lib/session";
import { safeAction } from "@/app/_lib/safe-action";
import { textValues, type FormState } from "@/app/_lib/form-state";
import { AppError } from "@/platform/errors";
import { parseMoney } from "@/modules/ledger";
import { applyReceiptToInvoice, unapplyReceiptAllocation } from "@/modules/payments";

// Expected balances come from the server-rendered review, never editable fields.
export async function applyReceiptAllocationAction(companyId: string, paymentId: string, invoiceId: string, expectedPaymentCents: string, expectedInvoiceCents: string, _previous: FormState, form: FormData): Promise<FormState> {
  const values = textValues(form, ["amount", "date"]);
  return safeAction(async () => {
    if (form.get("confirm") !== "yes") throw new AppError("receiptAllocations.confirm");
    const session = await requireSession();
    const cents = parseMoney(values.amount ?? "", (await getLocale()) === "en" ? "en" : "fr-CA");
    if (cents === null || cents <= 0n) throw new AppError("receiptAllocations.invalid");
    await applyReceiptToInvoice({ userId: session.userId, companyId }, { paymentId, invoiceId, amountCents: String(cents), expectedPaymentCents, expectedInvoiceCents, date: values.date });
    revalidatePath(`/c/${companyId}`, "layout");
    redirect(`/c/${companyId}/encaissements/${paymentId}`);
  }, values);
}

export async function unapplyReceiptAllocationAction(companyId: string, paymentId: string, applicationId: string, _previous: FormState, form: FormData): Promise<FormState> {
  const values = textValues(form, ["date"]);
  return safeAction(async () => {
    if (form.get("confirm") !== "yes") throw new AppError("receiptAllocations.confirm");
    const session = await requireSession();
    await unapplyReceiptAllocation({ userId: session.userId, companyId }, applicationId, { date: values.date });
    revalidatePath(`/c/${companyId}`, "layout");
    redirect(`/c/${companyId}/encaissements/${paymentId}`);
  }, values);
}
