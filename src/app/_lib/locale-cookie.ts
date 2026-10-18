import "server-only";
import { cookies } from "next/headers";
import { LOCALE_COOKIE } from "@/platform/i18n/locales";

/** The interface language is remembered for a year; an unknown value is ignored by the request config. */
export async function setLocaleCookie(locale: string): Promise<void> {
  (await cookies()).set(LOCALE_COOKIE, locale, { path: "/", maxAge: 365 * 24 * 60 * 60, sameSite: "lax" });
}

/**
 * Applies the language stored in the account to a browser that has chosen none yet (a new device). A language
 * picked in this browser wins: the header switch only sets the cookie, so overriding it at every sign-in
 * would undo the user's choice.
 */
export async function setLocaleCookieIfUnset(locale: string): Promise<void> {
  if (!(await cookies()).get(LOCALE_COOKIE)) await setLocaleCookie(locale);
}
