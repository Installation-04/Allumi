"use server";
import { getLocale } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/app/_lib/session";
import { safeAction } from "@/app/_lib/safe-action";
import { textValues, type FormState } from "@/app/_lib/form-state";
import { createBudget, saveBudgetTarget, removeBudgetTarget } from "@/modules/budgets";
import { parseMoney } from "@/modules/ledger";
import { AppError } from "@/platform/errors";
function unique(form:FormData,names:string[]) { if(names.some(n=>form.getAll(n).length!==1 || typeof form.get(n)!=="string")) throw new AppError("budgets.invalid"); }
export async function createAction(companyId:string,_previous:FormState,form:FormData):Promise<FormState> {
  const values=textValues(form,["name","fiscalYearId"]);
  return safeAction(async()=>{
    unique(form,["name","fiscalYearId"]);
    const {userId}=await requireSession();const id=await createBudget({userId,companyId},{name:values.name??"",fiscalYearId:values.fiscalYearId??""});
    revalidatePath(`/c/${companyId}`,"layout");redirect(`/c/${companyId}/budgets/${id}`);
  },values);
}
export async function saveTargetAction(companyId:string,id:string,revision:number,_previous:FormState,form:FormData):Promise<FormState> {
  const values=textValues(form,["accountId","amount"]);
  return safeAction(async()=>{
    unique(form,["accountId","amount"]);
    const {userId}=await requireSession();const cents=parseMoney(values.amount??"",(await getLocale())==="en"?"en":"fr-CA");
    if(cents===null) throw new AppError("budgets.invalid");
    await saveBudgetTarget({userId,companyId},id,{accountId:values.accountId??"",amountCents:cents,revision});
    revalidatePath(`/c/${companyId}`,"layout");return {notice:"saved"};
  },values);
}
export async function removeTargetAction(companyId:string,id:string,accountId:string,revision:number,_previous:FormState,_form:FormData):Promise<FormState> {
  return safeAction(async()=>{
    const {userId}=await requireSession();await removeBudgetTarget({userId,companyId},id,accountId,revision);
    revalidatePath(`/c/${companyId}`,"layout");return {notice:"saved"};
  });
}
