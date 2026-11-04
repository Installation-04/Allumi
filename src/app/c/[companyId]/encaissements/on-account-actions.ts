"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { requireSession } from "@/app/_lib/session";
import { safeAction } from "@/app/_lib/safe-action";
import { textValues, type FormState } from "@/app/_lib/form-state";
import { AppError } from "@/platform/errors";
import { parseMoney } from "@/modules/ledger";
import { recordOnAccountReceipt } from "@/modules/payments";

// A submission token and customer are bound by the server so action retries cannot duplicate a receipt.
export async function recordOnAccountReceiptAction(companyId: string, contactId: string, submissionId: string, _previous: FormState, form: FormData): Promise<FormState> {
  const values = textValues(form, ["amount", "date", "accountId", "method", "reference", "memo"]);
  return safeAction(async () => {
    if (form.get("confirm") !== "yes") throw new AppError("onAccountReceipts.confirm");
    const session = await requireSession();
    const cents = parseMoney(values.amount ?? "", (await getLocale()) === "en" ? "en" : "fr-CA");
    if (cents === null || cents <= 0n) throw new AppError("onAccountReceipts.invalid");
    const receipt = await recordOnAccountReceipt({ userId: session.userId, companyId }, { contactId, submissionId, amountCents: String(cents), date: values.date, accountId: values.accountId, method: values.method, reference: values.reference, memo: values.memo });
    revalidatePath(`/c/${companyId}`, "layout");
    redirect(`/c/${companyId}/encaissements/${receipt.id}`);
  }, values);
}
