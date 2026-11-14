"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/app/_lib/session";
import { safeAction } from "@/app/_lib/safe-action";
import { textValues, type FormState } from "@/app/_lib/form-state";
import { importOfficialTaxes } from "@/modules/taxes";
import { AppError } from "@/platform/errors";
export async function importAction(companyId:string,_state:FormState,form:FormData):Promise<FormState> {
  const keys=["province","date","fingerprint","code","federalPayable","federalRecoverable","qstPayable","qstRecoverable","confirmed"];
  const values=textValues(form,keys);
  return safeAction(async()=>{
    for(const key of keys)if(form.getAll(key).length>1)throw new AppError("officialTaxes.invalid");
    const session=await requireSession();
    const id=await importOfficialTaxes({userId:session.userId,companyId},values);
    revalidatePath(`/c/${companyId}`,"layout");redirect(`/c/${companyId}/taxes?importe=${id}`);
  },values);
}
