"use server";
import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {requireSession} from "@/app/_lib/session";
import {safeAction} from "@/app/_lib/safe-action";
import {textValues,type FormState} from "@/app/_lib/form-state";
import {AppError} from "@/platform/errors";
import {createRecurringPlan,changeRecurringStatus,generateRecurringDraft} from "@/modules/sales";
export async function createRecurringAction(companyId:string,_previous:FormState,form:FormData):Promise<FormState> {
 const values=textValues(form,["creationKey","sourceInvoiceId","name","startDate","endDate","intervalMonths","anchorDay","termDays"]);
 return safeAction(async()=>{if(form.get("confirm")!=="yes")throw new AppError("recurring.confirm");const session=await requireSession();const id=await createRecurringPlan({userId:session.userId,companyId},values);revalidatePath(`/c/${companyId}`,"layout");redirect(`/c/${companyId}/recurrences/${id}`);},values);
}
export async function recurringStatusAction(companyId:string,id:string,revision:string,status:"ACTIVE"|"PAUSED"|"CANCELLED",_previous:FormState,form:FormData):Promise<FormState> {
 return safeAction(async()=>{if(form.get("confirm")!=="yes")throw new AppError("recurring.confirm");const session=await requireSession();await changeRecurringStatus({userId:session.userId,companyId},id,revision,status);revalidatePath(`/c/${companyId}`,"layout");});
}
export async function recurringGenerateAction(companyId:string,id:string,revision:string,date:string,_previous:FormState,form:FormData):Promise<FormState> {
 return safeAction(async()=>{if(form.get("confirm")!=="yes")throw new AppError("recurring.confirm");const session=await requireSession();const draftId=await generateRecurringDraft({userId:session.userId,companyId},id,revision,date);revalidatePath(`/c/${companyId}`,"layout");redirect(`/c/${companyId}/factures/${draftId}`);});
}
