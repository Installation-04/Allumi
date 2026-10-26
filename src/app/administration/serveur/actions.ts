"use server";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/app/_lib/session";
import { safeAction } from "@/app/_lib/safe-action";
import type { FormState } from "@/app/_lib/form-state";
import { requestServerOperation } from "@/modules/server";
export async function serverAction(_state: FormState, form: FormData): Promise<FormState> {
  return safeAction(async () => {
    const session = await requireSession();
    if (form.get("confirm") !== "yes") return { messageKey: "members.confirm" };
    await requestServerOperation(session.userId, Object.fromEntries(form));
    revalidatePath("/administration/serveur");
    return { notice: "saved" };
  });
}
