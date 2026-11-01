"use server";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/app/_lib/session";
import { safeAction } from "@/app/_lib/safe-action";
import type { FormState } from "@/app/_lib/form-state";
import { AppError } from "@/platform/errors";
import { uploadSalesAttachment } from "@/modules/attachments";
export async function uploadAction(companyId: string, documentId: string, _previous: FormState, form: FormData): Promise<FormState> {
 return safeAction(async()=>{
  const session=await requireSession();
  const file=form.get("file");
  if (!(file instanceof File) || file.size<=0 || file.size>4*1024*1024) throw new AppError("attachments.invalid");
  await uploadSalesAttachment({userId:session.userId,companyId},documentId,file.name,new Uint8Array(await file.arrayBuffer()));
  revalidatePath(`/c/${companyId}`,"layout");
 });
}

export async function detachAction(companyId: string, documentId: string, id: string, _previous: FormState, form: FormData): Promise<FormState> {
 return safeAction(async()=>{
  if (form.get("confirm")!=="yes") throw new AppError("attachments.confirm");
  const session=await requireSession();
  const {detachSalesAttachment}=await import("@/modules/attachments");
  await detachSalesAttachment({userId:session.userId,companyId},documentId,id);
  revalidatePath(`/c/${companyId}`,"layout");
 });
}
