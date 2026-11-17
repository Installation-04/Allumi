"use server";
import { getLocale } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/app/_lib/session";
import { safeAction } from "@/app/_lib/safe-action";
import { textValues, type FormState } from "@/app/_lib/form-state";
import { createBudget, saveBudgetTarget, removeBudgetTarget, duplicateBudget, importBudgetCsv, decodeBudgetCsv, MAX_BUDGET_CSV_BYTES, saveMonthlyAllocation } from "@/modules/budgets";
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
export async function duplicateAction(companyId:string,sourceId:string,sourceRevision:number,stateToken:string,_previous:FormState,form:FormData):Promise<FormState> {
  const values=textValues(form,["name","fiscalYearId"]);
  return safeAction(async()=>{
    unique(form,["name","fiscalYearId"]);
    const flags=form.getAll("skipInactive");
    if(flags.length>1 || (flags.length===1&&flags[0]!=="yes")) throw new AppError("budgets.invalid");
    const {userId}=await requireSession();
    const id=await duplicateBudget({userId,companyId},sourceId,{name:values.name??"",fiscalYearId:values.fiscalYearId??"",sourceRevision,stateToken,skipInactive:flags.length===1});
    revalidatePath(`/c/${companyId}`,"layout");redirect(`/c/${companyId}/budgets/${id}`);
  },values);
}
export async function importCsvAction(companyId:string,_previous:FormState,form:FormData):Promise<FormState>{
  const values=textValues(form,["name","fiscalYearId","format"]);
  return safeAction(async()=>{
    unique(form,["name","fiscalYearId","format","review","confirmed"]);
    if(form.getAll("file").length!==1)throw new AppError("budgets.importInvalid");
    const {userId}=await requireSession();
    if(form.get("confirmed")!=="yes")throw new AppError("budgets.importConfirm");
    const file=form.get("file");
    if(!(file instanceof File)||!file.size||file.size>MAX_BUDGET_CSV_BYTES)throw new AppError("budgets.importInvalid");
    const raw=form.get("review");if(typeof raw!=="string"||raw.length>MAX_BUDGET_CSV_BYTES)throw new AppError("budgets.importInvalid");
    let review;try{review=JSON.parse(raw);}catch{throw new AppError("budgets.importInvalid");}
    let text;try{text=decodeBudgetCsv(new Uint8Array(await file.arrayBuffer()));}catch{throw new AppError("budgets.importInvalid");}
    const format=values.format;if(format!=="en"&&format!=="fr-CA")throw new AppError("budgets.importInvalid");
    const id=await importBudgetCsv({userId,companyId},{name:values.name??"",fiscalYearId:values.fiscalYearId??"",format,text,review});
    revalidatePath(`/c/${companyId}`,"layout");redirect(`/c/${companyId}/budgets/${id}`);
  },values);
}
export async function saveMonthsAction(companyId:string,budgetId:string,accountId:string,revision:number,periodIds:string[],returnPeriod:string,_previous:FormState,form:FormData):Promise<FormState>{
  const names=periodIds.map(id=>`period_${id}`),values=textValues(form,names);
  return safeAction(async()=>{
    unique(form,names);
    if([...form.keys()].some(k=>k.startsWith('period_')&&!names.includes(k)))throw new AppError('budgets.monthlyInvalid');
    const {userId}=await requireSession(),locale=(await getLocale())==='en'?'en':'fr-CA';
    const targets=periodIds.map(periodId=>{const value=values[`period_${periodId}`]??'';if(!value.trim())return {periodId,amountCents:null};const cents=parseMoney(value,locale);if(cents===null)throw new AppError('budgets.monthlyInvalid');return {periodId,amountCents:cents};});
    await saveMonthlyAllocation({userId,companyId},budgetId,accountId,{revision,targets});
    revalidatePath(`/c/${companyId}`,'layout');redirect(`/c/${companyId}/budgets/${budgetId}/mensuel?periode=${encodeURIComponent(periodIds.includes(returnPeriod)?returnPeriod:periodIds[0]??'')}`);
  },values);
}
