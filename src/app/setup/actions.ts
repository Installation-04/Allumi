"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createSession, setupInstance, setupSchema } from "@/modules/auth";
import { clientIp, setSessionCookie, userAgent } from "@/app/_lib/session";
import { textValues, type FormState } from "@/app/_lib/form-state";
import { LOCALE_COOKIE } from "@/platform/i18n/locales";

const VALUE_FIELDS = ["companyName", "displayName", "email", "locale", "fiscalYearStartMonth"];

export async function setupAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const values = textValues(formData, VALUE_FIELDS);
  const parsed = setupSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const mismatch = parsed.error.issues.some((issue) => issue.path[0] === "passwordConfirm");
    return { error: mismatch ? "mismatch" : "invalid", values };
  }

  const result = await setupInstance(parsed.data, await clientIp());
  switch (result.status) {
    case "rate_limited":
      return { error: "rateLimited", values };
    case "invalid_token":
      return { error: "setupToken", values };
    case "already_set_up":
      return { error: "alreadySetUp", values };
    case "weak_password":
      return { error: result.problem, values };
  }

  const session = await createSession(result.userId, await userAgent());
  await setSessionCookie(session.token, session.expiresAt);
  (await cookies()).set(LOCALE_COOKIE, parsed.data.locale, { path: "/", maxAge: 365 * 24 * 60 * 60, sameSite: "lax" });
  redirect(`/c/${result.companyId}`);
}
