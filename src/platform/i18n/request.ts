import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import french from "../../../messages/fr-CA.json";
import english from "../../../messages/en.json";
import { APP_TIME_ZONE, LOCALE_COOKIE, resolveLocale, type Locale } from "./locales";

const catalogs: Record<Locale, typeof french> = { "fr-CA": french, en: english };

// React cache is scoped to a server render/request. Never cache cookie-derived state at module level.
export default cache(async () => {
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value, process.env.DEFAULT_LOCALE);
  return { locale, messages: catalogs[locale], timeZone: APP_TIME_ZONE };
});
