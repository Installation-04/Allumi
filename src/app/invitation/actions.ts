"use server";
import { redirect } from "next/navigation";
import { acceptInvitation } from "@/modules/auth";
import { getSession, clientIp } from "@/app/_lib/session";
import { safeAction } from "@/app/_lib/safe-action";
import type { FormState } from "@/app/_lib/form-state";
export async function acceptAction(_state: FormState, form: FormData): Promise<FormState> {
  return safeAction(async () => {
    const session = await getSession();
    if (session?.mfaPending) redirect("/connexion/2fa");
    const companyId = await acceptInvitation(Object.fromEntries(form), await clientIp(), session?.userId);
    redirect(session ? `/c/${companyId}` : "/connexion");
  });
}
