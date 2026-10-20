"use server";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/app/_lib/session";
import { safeAction } from "@/app/_lib/safe-action";
import type { FormState } from "@/app/_lib/form-state";
import { requestUpdate } from "@/modules/updates";
export async function updateServerAction(_previous: FormState, form: FormData): Promise<FormState> {
  return safeAction(async () => {
    const session = await requireSession();
    if (form.get("confirm") !== "yes") return { messageKey: "updates.confirm" };
    await requestUpdate(session.userId, String(form.get("target") ?? ""));
    revalidatePath("/versions");
    return undefined;
  });
}
