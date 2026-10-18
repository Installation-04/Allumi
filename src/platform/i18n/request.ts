import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { isLocale, type Locale } from "./locales";

// No locale prefix in URLs: the language comes from a cookie, then DEFAULT_LOCALE.
export default getRequestConfig(async () => {
  const store = await cookies();
  const fromCookie = store.get("allumi_locale")?.value;
  const fallback = process.env.DEFAULT_LOCALE;
  const locale: Locale = isLocale(fromCookie) ? fromCookie : isLocale(fallback) ? fallback : "fr-CA";
  const messages = (await import(`../../../messages/${locale}.json`)).default;
  return { locale, messages, timeZone: "America/Toronto" };
});
