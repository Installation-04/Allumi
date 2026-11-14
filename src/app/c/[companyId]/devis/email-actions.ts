"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/app/_lib/session";
import { safeAction } from "@/app/_lib/safe-action";
import { textValues, type FormState } from "@/app/_lib/form-state";
import { AppError } from "@/platform/errors";
import { sendEstimateEmail } from "@/modules/sales";

export async function sendEstimateEmailAction(companyId: string, estimateId: string, attemptId: string, locale: "fr-CA" | "en", _state: FormState, form: FormData): Promise<FormState> {
  const values = textValues(form, ["recipient"]);
  return safeAction(async () => {
    if (form.get("confirm") !== "yes") throw new AppError("estimateEmail.confirm");
    const session = await requireSession();
    await sendEstimateEmail({ userId: session.userId, companyId }, estimateId, { attemptId, recipient: values.recipient ?? "", locale, confirmResend: form.get("confirmResend") === "yes" });
    revalidatePath(`/c/${companyId}`, "layout");
    redirect(`/c/${companyId}/devis/${estimateId}`);
  }, values);
}
