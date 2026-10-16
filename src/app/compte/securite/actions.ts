"use server";

import { revalidatePath } from "next/cache";
import { beginTotpEnrollment, codeSchema, confirmTotpEnrollment, disableTotp, getProfile } from "@/modules/auth";
import { readSessionToken, requireSession } from "@/app/_lib/session";
import { markMfaVerified } from "@/modules/auth";
import type { FormState } from "@/app/_lib/form-state";

export async function beginEnrollmentAction(): Promise<void> {
  const session = await requireSession();
  const profile = await getProfile(session.userId);
  if (profile) await beginTotpEnrollment(session.userId, profile.email);
  revalidatePath("/compte/securite");
}

export async function confirmEnrollmentAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const session = await requireSession();
  const token = await readSessionToken();
  const parsed = codeSchema.safeParse({ code: formData.get("code") });
  if (!parsed.success) return { error: "invalid" };

  const recoveryCodes = await confirmTotpEnrollment(session.userId, parsed.data.code);
  if (!recoveryCodes) return { error: "code" };
  // This session just proved the second factor.
  if (token) await markMfaVerified(session.userId, token);
  // No revalidation here: re-rendering would switch the page to the "enabled" view and unmount the
  // form that shows the recovery codes, which are displayed only this once.
  return { recoveryCodes };
}

export async function disableTotpAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const session = await requireSession();
  const parsed = codeSchema.safeParse({ code: formData.get("code") });
  const password = String(formData.get("password") ?? "");
  if (!parsed.success || !password) return { error: "invalid" };

  const result = await disableTotp(session.userId, password, parsed.data.code);
  if (result === "rate_limited") return { error: "rateLimited" };
  if (result === "invalid") return { error: "code" };
  revalidatePath("/compte/securite");
  return undefined;
}
