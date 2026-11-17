export const LOCALES = ["fr-CA", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const LOCALE_COOKIE = "allumi_locale";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

export const APP_TIME_ZONE = "America/Toronto";

/** An explicit supported cookie wins; untrusted/unknown values fall back to instance language. */
export function resolveLocale(cookie: unknown, fallback: unknown): Locale {
  return isLocale(cookie) ? cookie : isLocale(fallback) ? fallback : "fr-CA";
}
