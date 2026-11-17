import { AsyncLocalStorage } from "node:async_hooks";
import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ cookies: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
import { getFormatter, getLocale, getMessages, getTranslations } from "@/platform/i18n/server";
import { resolveLocale } from "@/platform/i18n/locales";
import en from "../../messages/en.json";
import fr from "../../messages/fr-CA.json";

afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });

it("selects only supported locale cookies, then the instance default, then French", () => {
  expect(resolveLocale("en", "fr-CA")).toBe("en");
  expect(resolveLocale("fr-CA", "en")).toBe("fr-CA");
  for (const value of [undefined, "", "EN", "fr", "../../en", "__proto__", { locale: "en" }]) {
    expect(resolveLocale(value, "en")).toBe("en");
    expect(resolveLocale(value, "unknown")).toBe("fr-CA");
  }
});

it("keeps concurrent server translations, catalogues and formatting in the cookie language", async () => {
  const requests = new AsyncLocalStorage<string | undefined>();
  vi.stubEnv("DEFAULT_LOCALE", "fr-CA");
  mocks.cookies.mockImplementation(async () => {
    const locale = requests.getStore();
    await new Promise<void>(resolve => setTimeout(resolve, locale === "en" ? 2 : 0));
    return { get: (key: string) => key === "allumi_locale" && locale ? { value: locale } : undefined };
  });
  const run = (locale: "fr-CA" | "en") => requests.run(locale, async () => {
    const [actualLocale, messages, t, format] = await Promise.all([getLocale(), getMessages(), getTranslations("budgets"), getFormatter()]);
    expect(actualLocale).toBe(locale);
    const expected = locale === "en" ? en : fr;
    expect(messages.app.tagline).toBe(expected.app.tagline);
    expect(t("monthlyTitle")).toBe(expected.budgets.monthlyTitle);
    expect(t("monthlyRange", { number: 3, from: "2026-06-01", to: "2026-06-30" })).toContain("2026-06-01");
    const instant = new Date("2026-01-01T02:30:00Z");
    expect(format.dateTime(instant, { year: "numeric", month: "2-digit", day: "2-digit" })).toBe(new Intl.DateTimeFormat(locale, { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).format(instant));
    expect(format.number(1234.5, { style: "currency", currency: "CAD" })).toBe(new Intl.NumberFormat(locale, { style: "currency", currency: "CAD" }).format(1234.5));
    const all = await getTranslations();
    expect(all("app.tagline")).toBe(expected.app.tagline);
  });
  await Promise.all(Array.from({ length: 20 }, (_, i) => run(i % 2 ? "en" : "fr-CA")));
});

it("uses a valid default for invalid cookies and preserves ICU plural interpolation", async () => {
  vi.stubEnv("DEFAULT_LOCALE", "en");
  mocks.cookies.mockResolvedValue({ get: () => ({ value: "../../fr-CA" }) });
  expect(await getLocale()).toBe("en");
  const t = await getTranslations("budgets");
  expect(t("coverage", { count: 1 })).toMatch(/^1 account with/);
  expect(t("coverage", { count: 2 })).toMatch(/^2 accounts with/);
  vi.stubEnv("DEFAULT_LOCALE", "unsupported");
  expect(await getLocale()).toBe("fr-CA");
});
