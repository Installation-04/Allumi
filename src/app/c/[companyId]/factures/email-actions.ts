"use server";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/app/_lib/session";
import { safeAction } from "@/app/_lib/safe-action";
import type { FormState } from "@/app/_lib/form-state";
import { AppError } from "@/platform/errors";
import { sendInvoiceEmail } from "@/modules/sales";
export async function sendInvoiceEmailAction(companyId: string, documentId: string, attemptId: string, _previous: FormState, form: FormData): Promise<FormState> {
  return safeAction(async()=>{
    const session=await requireSession();
    if(form.get("confirm")!=="yes") throw new AppError("invoiceEmail.confirm");
    const locale=form.get("locale");
    if(locale!=="fr-CA" && locale!=="en") throw new AppError("invoiceEmail.invalid");
    await sendInvoiceEmail({userId:session.userId,companyId},documentId,{attemptId,recipient:String(form.get("recipient")??"").trim(),locale,confirmResend:form.get("confirmResend")==="yes"});
    revalidatePath(`/c/${companyId}/factures/validees/${documentId}`);
  });
}
