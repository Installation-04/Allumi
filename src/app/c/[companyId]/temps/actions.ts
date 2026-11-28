"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AppError } from "@/platform/errors";
import { requireSession } from "@/app/_lib/session";
import { safeAction } from "@/app/_lib/safe-action";
import { textValues, type FormState } from "@/app/_lib/form-state";
import { createTimeEntry, updateTimeEntry, deleteTimeEntry, parseDuration, timeQuery, entryYearFilters, type TimeInput } from "@/modules/time";
import { getProjectByCode } from "@/modules/projects";
import { todayIso } from "@/modules/ledger";

const names=["date","project","projectCode","person","task","notes","usage","duration"];
async function read(form:FormData,actor:{userId:string;companyId:string}):Promise<TimeInput> {
  if(names.some(n=>form.getAll(n).length!==1||typeof form.get(n)!=="string"))throw new AppError("time.invalid");
  const v=textValues(form,names),minutes=parseDuration(v.duration??"");
  if(minutes===null)throw new AppError("time.duration");
  if(v.usage!=="BILLABLE"&&v.usage!=="NON_BILLABLE")throw new AppError("time.invalid");
  const projectId=v.projectCode?.trim()?(await getProjectByCode(actor,v.projectCode)).id:null;
  return {projectId,date:v.date??"",project:v.project??"",person:v.person??"",task:v.task??"",notes:v.notes??"",usage:v.usage,minutes};
}
export async function createAction(companyId:string,_previous:FormState,form:FormData):Promise<FormState> {
  return safeAction(async()=>{const {userId}=await requireSession();const id=await createTimeEntry({userId,companyId},await read(form,{userId,companyId}));revalidatePath(`/c/${companyId}/temps`);redirect(`/c/${companyId}/temps/${id}`);},textValues(form,names));
}
export async function updateAction(companyId:string,id:string,revision:number,_previous:FormState,form:FormData):Promise<FormState> {
  return safeAction(async()=>{const {userId}=await requireSession();await updateTimeEntry({userId,companyId},id,revision,await read(form,{userId,companyId}),form.getAll("unlinkConfirmed").length===1&&form.get("unlinkConfirmed")==="yes");revalidatePath(`/c/${companyId}/temps/${id}`);revalidatePath(`/c/${companyId}/temps`);redirect(`/c/${companyId}/temps/${id}`);},textValues(form,names));
}
export async function deleteAction(companyId:string,id:string,revision:number,_previous:FormState,form:FormData):Promise<FormState> {
  return safeAction(async()=>{const {userId}=await requireSession();if(form.getAll("confirmed").length!==1||form.get("confirmed")!=="yes")throw new AppError("time.confirm");const date=await deleteTimeEntry({userId,companyId},id,revision,true);revalidatePath(`/c/${companyId}/temps/${id}`);revalidatePath(`/c/${companyId}/temps`);redirect(`/c/${companyId}/temps?${timeQuery(entryYearFilters(date,todayIso()))}`);});
}
