"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { requireSession } from "@/app/_lib/session";
import { safeAction } from "@/app/_lib/safe-action";
import { textValues, type FormState } from "@/app/_lib/form-state";
import { AppError } from "@/platform/errors";
import { parseMoney } from "@/modules/ledger";
import { recordReceiptRefund } from "@/modules/payments";

// The server binds both the reviewed balance and a retry token; neither is an editable field.
export async function recordReceiptRefundAction(companyId: string, receiptId: string, expectedOpenCents: string, submissionId: string, _previous: FormState, form: FormData): Promise<FormState> {
  const values = textValues(form, ["amount", "date", "accountId", "method", "reference", "memo"]);
  return safeAction(async () => {
    if (form.get("confirm") !== "yes") throw new AppError("receiptRefunds.confirm");
    const session = await requireSession();
    const cents = parseMoney(values.amount ?? "", (await getLocale()) === "en" ? "en" : "fr-CA");
    if (cents === null || cents <= 0n) throw new AppError("receiptRefunds.invalid");
    const refund = await recordReceiptRefund({ userId: session.userId, companyId }, {
      receiptId, expectedOpenCents, submissionId, amountCents: String(cents), date: values.date,
      accountId: values.accountId, method: values.method, reference: values.reference, memo: values.memo,
    });
    revalidatePath(`/c/${companyId}`, "layout");
    redirect(`/c/${companyId}/remboursements/${refund.id}`);
  }, values);
}
