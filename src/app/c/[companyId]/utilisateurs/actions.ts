"use server";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/app/_lib/session";
import { safeAction } from "@/app/_lib/safe-action";
import type { FormState } from "@/app/_lib/form-state";
import { MODULES, inviteMember, changeMemberRole, removeMember, revokeInvitation } from "@/modules/companies";
import { AppError } from "@/platform/errors";
const permissions = (form: FormData) => Object.fromEntries(MODULES.flatMap(m => form.get(m) && form.get(m) !== "default" ? [[m, String(form.get(m))]] : []));
export async function inviteAction(companyId: string, _previous: FormState, form: FormData): Promise<FormState> {
  return safeAction(async () => {
    const session = await requireSession();
    const invitationCode = await inviteMember({ companyId, userId: session.userId }, { email: form.get("email"), role: form.get("role"), moduleAccess: permissions(form) });
    revalidatePath(`/c/${companyId}/utilisateurs`);
    return { invitationCode };
  });
}
export async function memberAction(companyId: string, id: string, operation: "save" | "remove" | "revoke", _previous: FormState, form: FormData): Promise<FormState> {
  return safeAction(async () => {
    const session = await requireSession();
    const actor = { companyId, userId: session.userId };
    if (operation === "save") await changeMemberRole(actor, id, form.get("role"), permissions(form));
    else {
      if (form.get("confirm") !== "yes") throw new AppError("members.confirm");
      if (operation === "remove") await removeMember(actor, id); else await revokeInvitation(actor, id);
    }
    revalidatePath(`/c/${companyId}`, "layout");
    return { notice: "saved" };
  });
}

export async function serverAccessAction(target: string, enabled: boolean, _state: FormState, form: FormData): Promise<FormState> {
  return safeAction(async () => {
    const session = await requireSession();
    const { setServerAccess } = await import("@/modules/auth");
    await setServerAccess(session.userId, target, enabled, String(form.get("password") ?? ""));
    revalidatePath("/", "layout");
    return { notice: "saved" };
  });
}
