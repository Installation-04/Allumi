"use server";

import { redirect } from "next/navigation";
import { attemptLogin, destroySession, getProfile, loginSchema } from "@/modules/auth";
import { clearSessionCookie, clientIp, getSession, readSessionToken, setSessionCookie, userAgent } from "@/app/_lib/session";
import { setLocaleCookie } from "@/app/_lib/locale-cookie";
import { textValues, type FormState } from "@/app/_lib/form-state";
import { safeAction } from "@/app/_lib/safe-action";

export async function loginAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const values = textValues(formData, ["email"]);
  return safeAction(async () => {
    const parsed = loginSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
    if (!parsed.success) return { error: "invalid", values };

    const result = await attemptLogin({ ...parsed.data, ip: await clientIp(), userAgent: await userAgent() });
    if (result.status === "rate_limited") return { error: "rateLimited", values };
    if (result.status === "invalid") return { error: "credentials", values };

    await setSessionCookie(result.token, result.expiresAt);
    // The language chosen in the account follows the user to a new browser or device.
    const profile = await getProfile(result.userId);
    if (profile) await setLocaleCookie(profile.locale);
    redirect(result.mfaRequired ? "/connexion/2fa" : "/");
  }, values);
}

export async function logoutAction(): Promise<void> {
  const [session, token] = [await getSession(), await readSessionToken()];
  if (session && token) await destroySession(session.userId, token);
  await clearSessionCookie();
  redirect("/connexion");
}
