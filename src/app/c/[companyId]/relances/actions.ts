"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/app/_lib/session";
import { safeAction } from "@/app/_lib/safe-action";
import { textValues, type FormState } from "@/app/_lib/form-state";
import { AppError } from "@/platform/errors";
import { sendInvoiceReminder } from "@/modules/sales";

export async function sendReminderAction(companyId: string, invoiceId: string, attemptId: string, locale: "fr-CA" | "en", expectedOpenCents: string, expectedDate: string, expectedDueDate: string, _state: FormState, form: FormData): Promise<FormState> {
  const values = textValues(form, ["recipient"]);
  return safeAction(async () => {
    if (form.get("confirm") !== "yes") throw new AppError("reminders.confirm");
    const session = await requireSession();
    await sendInvoiceReminder({ companyId, userId: session.userId }, invoiceId, { attemptId, recipient: values.recipient ?? "", locale, expectedOpenCents, expectedDate, expectedDueDate, confirmResend: form.get("confirmResend") === "yes" });
    revalidatePath(`/c/${companyId}`, "layout");
    redirect(`/c/${companyId}/factures/validees/${invoiceId}`);
  }, values);
}
