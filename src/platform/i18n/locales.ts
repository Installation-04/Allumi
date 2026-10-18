export const LOCALES = ["fr-CA", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const LOCALE_COOKIE = "allumi_locale";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}
