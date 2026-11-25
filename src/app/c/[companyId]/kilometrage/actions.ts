"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getLocale } from "@/platform/i18n/server";
import { AppError } from "@/platform/errors";
import { requireSession } from "@/app/_lib/session";
import { safeAction } from "@/app/_lib/safe-action";
import { textValues, type FormState } from "@/app/_lib/form-state";
import { createMileageTrip, updateMileageTrip, deleteMileageTrip, parseKilometers, mileageQuery, tripYearFilters, type TripInput } from "@/modules/mileage";
import { todayIso } from "@/modules/ledger";

const names=["date","vehicle","origin","destination","purpose","usage","distance"];
async function read(form:FormData):Promise<TripInput> {
  if(names.some(n=>form.getAll(n).length!==1||typeof form.get(n)!=="string"))throw new AppError("mileage.invalid");
  const v=textValues(form,names),locale=(await getLocale())==="en"?"en":"fr-CA",distanceMeters=parseKilometers(v.distance??"",locale);
  if(distanceMeters===null)throw new AppError("mileage.distance");
  if(v.usage!=="BUSINESS"&&v.usage!=="PERSONAL")throw new AppError("mileage.invalid");
  return {date:v.date??"",vehicle:v.vehicle??"",origin:v.origin??"",destination:v.destination??"",purpose:v.purpose??"",usage:v.usage,distanceMeters};
}
export async function createAction(companyId:string,_previous:FormState,form:FormData):Promise<FormState> {
  return safeAction(async()=>{const {userId}=await requireSession();const id=await createMileageTrip({userId,companyId},await read(form));revalidatePath(`/c/${companyId}/kilometrage`);redirect(`/c/${companyId}/kilometrage/${id}`);},textValues(form,names));
}
export async function updateAction(companyId:string,id:string,revision:number,_previous:FormState,form:FormData):Promise<FormState> {
  return safeAction(async()=>{const {userId}=await requireSession();await updateMileageTrip({userId,companyId},id,revision,await read(form));revalidatePath(`/c/${companyId}/kilometrage/${id}`);revalidatePath(`/c/${companyId}/kilometrage`);redirect(`/c/${companyId}/kilometrage/${id}`);},textValues(form,names));
}
export async function deleteAction(companyId:string,id:string,revision:number,_previous:FormState,form:FormData):Promise<FormState> {
  return safeAction(async()=>{const {userId}=await requireSession();if(form.getAll("confirmed").length!==1||form.get("confirmed")!=="yes")throw new AppError("mileage.confirm");const date=await deleteMileageTrip({userId,companyId},id,revision,true);revalidatePath(`/c/${companyId}/kilometrage/${id}`);revalidatePath(`/c/${companyId}/kilometrage`);redirect(`/c/${companyId}/kilometrage?${mileageQuery(tripYearFilters(date,todayIso()))}`);});
}
