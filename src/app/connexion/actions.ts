"use server";

import { redirect } from "next/navigation";
import { attemptLogin, destroySession, loginSchema } from "@/modules/auth";
import { clearSessionCookie, clientIp, getSession, readSessionToken, setSessionCookie, userAgent } from "@/app/_lib/session";
import { textValues, type FormState } from "@/app/_lib/form-state";

export async function loginAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const values = textValues(formData, ["email"]);
  const parsed = loginSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: "invalid", values };

  const result = await attemptLogin({ ...parsed.data, ip: await clientIp(), userAgent: await userAgent() });
  if (result.status === "rate_limited") return { error: "rateLimited", values };
  if (result.status === "invalid") return { error: "credentials", values };

  await setSessionCookie(result.token, result.expiresAt);
  redirect(result.mfaRequired ? "/connexion/2fa" : "/");
}

export async function logoutAction(): Promise<void> {
  const [session, token] = [await getSession(), await readSessionToken()];
  if (session && token) await destroySession(session.userId, token);
  await clearSessionCookie();
  redirect("/connexion");
}
