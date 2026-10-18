import "server-only";
import { cookies } from "next/headers";
import { LOCALE_COOKIE } from "@/platform/i18n/locales";

/** The interface language is remembered for a year; an unknown value is ignored by the request config. */
export async function setLocaleCookie(locale: string): Promise<void> {
  (await cookies()).set(LOCALE_COOKIE, locale, { path: "/", maxAge: 365 * 24 * 60 * 60, sameSite: "lax" });
}
