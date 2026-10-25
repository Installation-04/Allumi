"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { requireSession } from "@/app/_lib/session";
import { safeAction } from "@/app/_lib/safe-action";
import { textValues, type FormState } from "@/app/_lib/form-state";
import { AppError } from "@/platform/errors";
import { parseMoney } from "@/modules/ledger";
import { recordReceipt, voidReceipt } from "@/modules/payments";

/**
 * Records a payment against an invoice. `expectedOpenCents` is the balance the page showed when it was drawn (it is
 * bound into the action, not typed); the service refuses if the invoice has changed since.
 */
export async function recordReceiptAction(companyId: string, invoiceId: string, expectedOpenCents: string, _previous: FormState, form: FormData): Promise<FormState> {
  const values = textValues(form, ["amount", "date", "accountId", "method", "reference", "memo"]);
  return safeAction(async () => {
    const session = await requireSession();
    const cents = parseMoney(values.amount ?? "", (await getLocale()) === "en" ? "en" : "fr-CA");
    if (cents === null || cents <= 0n) throw new AppError("payments.invalid");
    const receipt = await recordReceipt({ userId: session.userId, companyId }, {
      invoiceId, amountCents: String(cents), expectedOpenCents, date: values.date, accountId: values.accountId, method: values.method, reference: values.reference, memo: values.memo,
    });
    revalidatePath(`/c/${companyId}`, "layout");
    redirect(`/c/${companyId}/encaissements/${receipt.id}`);
  }, values);
}

export async function voidReceiptAction(companyId: string, paymentId: string, _previous: FormState, form: FormData): Promise<FormState> {
  const values = textValues(form, ["date", "reason"]);
  return safeAction(async () => {
    if (form.get("confirm") !== "yes") throw new AppError("payments.confirmVoid");
    const session = await requireSession();
    await voidReceipt({ userId: session.userId, companyId }, paymentId, values);
    revalidatePath(`/c/${companyId}`, "layout");
    return undefined;
  }, values);
}
