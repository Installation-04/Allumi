"use server";

import { redirect } from "next/navigation";
import { codeSchema, markMfaVerified, verifySecondFactor } from "@/modules/auth";
import { readSessionToken, requireSession } from "@/app/_lib/session";
import type { FormState } from "@/app/_lib/form-state";
import { safeAction } from "@/app/_lib/safe-action";

export async function mfaAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return safeAction(async () => {
    const session = await requireSession({ allowPending: true });
    const token = await readSessionToken();
    const parsed = codeSchema.safeParse({ code: formData.get("code") });
    if (!parsed.success || !token) return { error: "invalid" };

    const result = await verifySecondFactor(session.userId, parsed.data.code);
    if (result === "rate_limited") return { error: "rateLimited" };
    if (result === "invalid") return { error: "code" };

    await markMfaVerified(session.userId, token);
    redirect("/");
  });
}
