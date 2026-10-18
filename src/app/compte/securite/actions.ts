"use server";

import { revalidatePath } from "next/cache";
import { beginTotpEnrollment, codeSchema, confirmTotpEnrollment, disableTotp, getProfile } from "@/modules/auth";
import { readSessionToken, requireSession } from "@/app/_lib/session";
import type { FormState } from "@/app/_lib/form-state";
import { safeAction } from "@/app/_lib/safe-action";

export async function beginEnrollmentAction(): Promise<void> {
  const session = await requireSession();
  const profile = await getProfile(session.userId);
  if (profile) await beginTotpEnrollment(session.userId, profile.email);
  revalidatePath("/compte/securite");
}

export async function confirmEnrollmentAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return safeAction(() => confirmEnrollment(formData));
}

async function confirmEnrollment(formData: FormData): Promise<FormState> {
  const session = await requireSession();
  const parsed = codeSchema.safeParse({ code: formData.get("code") });
  const password = String(formData.get("password") ?? "");
  if (!parsed.success || !password) return { error: "invalid" };

  const keepSessionToken = await readSessionToken();
  const result = await confirmTotpEnrollment(session.userId, parsed.data.code, password, { keepSessionToken });
  if (result.status === "rate_limited") return { error: "rateLimited" };
  if (result.status === "invalid") return { error: "passwordOrCode" };
  // The panel keeps showing the codes (its state outlives the refresh); revalidating keeps the cached page,
  // which the browser reuses on Back, in step with the enabled state.
  revalidatePath("/compte/securite");
  return { recoveryCodes: result.recoveryCodes };
}

export async function disableTotpAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return safeAction(() => disableTotpFor(formData));
}

async function disableTotpFor(formData: FormData): Promise<FormState> {
  const session = await requireSession();
  const parsed = codeSchema.safeParse({ code: formData.get("code") });
  const password = String(formData.get("password") ?? "");
  if (!parsed.success || !password) return { error: "invalid" };

  const result = await disableTotp(session.userId, password, parsed.data.code, { keepSessionToken: await readSessionToken() });
  if (result === "rate_limited") return { error: "rateLimited" };
  if (result === "invalid") return { error: "passwordOrCode" };
  revalidatePath("/compte/securite");
  return undefined;
}
