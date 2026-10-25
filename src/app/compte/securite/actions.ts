"use server";

import { revalidatePath } from "next/cache";
import {
  beginTotpEnrollment,
  changePassword,
  codeSchema,
  confirmTotpEnrollment,
  disableTotp,
  getProfile,
  revokeOtherSessions,
  revokeSession,
} from "@/modules/auth";
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

export async function changePasswordAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return safeAction(() => changePasswordFor(formData));
}

async function changePasswordFor(formData: FormData): Promise<FormState> {
  const session = await requireSession();
  const [current, next, confirm] = ["currentPassword", "newPassword", "newPasswordConfirm"].map((name) => String(formData.get(name) ?? ""));
  if (!current || !next) return { error: "invalid" };
  if (next !== confirm) return { error: "mismatch" };

  const result = await changePassword(session.userId, current, next, { keepSessionToken: await readSessionToken() });
  switch (result.status) {
    case "rate_limited":
      return { error: "rateLimited" };
    case "invalid":
      return { error: "currentPassword" };
    case "weak_password":
      return { error: result.problem };
    case "same_password":
      return { error: "sameAsCurrent" };
  }
  revalidatePath("/compte/securite");
  return { notice: "saved" };
}

export async function revokeSessionAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  await revokeSession(session.userId, String(formData.get("sessionId") ?? ""), await readSessionToken());
  revalidatePath("/compte/securite");
}

export async function revokeOtherSessionsAction(): Promise<void> {
  const session = await requireSession();
  await revokeOtherSessions(session.userId, await readSessionToken());
  revalidatePath("/compte/securite");
}
