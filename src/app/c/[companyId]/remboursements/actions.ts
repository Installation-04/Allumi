"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { requireSession } from "@/app/_lib/session";
import { safeAction } from "@/app/_lib/safe-action";
import { textValues, type FormState } from "@/app/_lib/form-state";
import { AppError } from "@/platform/errors";
import { parseMoney } from "@/modules/ledger";
import { recordCustomerRefund, voidCustomerRefund } from "@/modules/payments";

/**
 * Records a refund against an available customer credit. `expectedOpenCents` is the balance the page showed when it was drawn (it is
 * bound into the action, not typed); the service refuses if its availability has changed since.
 */
export async function recordCustomerRefundAction(
  companyId: string,
  creditNoteId: string,
  expectedOpenCents: string,
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  const values = textValues(form, [
    "amount",
    "date",
    "accountId",
    "method",
    "reference",
    "memo",
  ]);
  return safeAction(async () => {
    if (form.get("confirm") !== "yes") throw new AppError("refunds.confirm");
    const session = await requireSession();
    const cents = parseMoney(
      values.amount ?? "",
      (await getLocale()) === "en" ? "en" : "fr-CA",
    );
    if (cents === null || cents <= 0n) throw new AppError("refunds.invalid");
    const receipt = await recordCustomerRefund(
      { userId: session.userId, companyId },
      {
        creditNoteId,
        amountCents: String(cents),
        expectedOpenCents,
        date: values.date,
        accountId: values.accountId,
        method: values.method,
        reference: values.reference,
        memo: values.memo,
      },
    );
    revalidatePath(`/c/${companyId}`, "layout");
    redirect(`/c/${companyId}/remboursements/${receipt.id}`);
  }, values);
}

export async function voidCustomerRefundAction(
  companyId: string,
  paymentId: string,
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  const values = textValues(form, ["date", "reason"]);
  return safeAction(async () => {
    if (form.get("confirm") !== "yes")
      throw new AppError("refunds.confirmVoid");
    const session = await requireSession();
    await voidCustomerRefund(
      { userId: session.userId, companyId },
      paymentId,
      values,
    );
    revalidatePath(`/c/${companyId}`, "layout");
    return undefined;
  }, values);
}
