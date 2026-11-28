"use server";
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { assignProjectEntry } from '@/modules/projects';
import { AppError } from '@/platform/errors';
import { requireSession } from '@/app/_lib/session';
import { safeAction } from '@/app/_lib/safe-action';
import type { FormState } from '@/app/_lib/form-state';

export async function classifyEntryAction(companyId:string,entryId:string,revision:number,projectId:string,detach:boolean,_previous:FormState,form:FormData):Promise<FormState>{
 return safeAction(async()=>{
  if(form.getAll('confirmed').length!==1||form.get('confirmed')!=='yes')throw new AppError('projectFinance.confirm');
  const {userId}=await requireSession();
  await assignProjectEntry({userId,companyId},projectId,entryId,revision,detach,true);
  revalidatePath(`/c/${companyId}`,'layout');
  redirect(`/c/${companyId}/journal/${entryId}`);
 });
}
