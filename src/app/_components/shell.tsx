import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { logoutAction } from "@/app/connexion/actions";
import { setLocale } from "@/app/langue/actions";
import { appVersion } from "@/platform/version";
import { FOCUS } from "./focus";
import { getSession } from "@/app/_lib/session";

export async function Header() {
  const t = await getTranslations("common");
  const locale = await getLocale();
  const session = await getSession();
  return (
    <header className="border-b border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
        <Link href="/" className={`inline-flex min-h-11 items-center gap-2 rounded-sm text-xl font-bold text-brand-700 dark:text-brand-500 ${FOCUS}`}>
          <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-700 text-lg text-white">a</span>
          Allumi
        </Link>
        <div className="flex flex-wrap items-center gap-3 text-sm">
        <nav aria-label={t("language")} className="flex items-center gap-3">
          {(["fr-CA", "en"] as const).map((code) => (
            <form key={code} action={setLocale.bind(null, code)}>
              <button
                type="submit"
                lang={code}
                aria-current={locale === code ? "true" : undefined}
                className={`min-h-11 rounded-sm px-1 ${FOCUS} ${locale === code ? "font-semibold underline" : "text-stone-600 hover:underline dark:text-stone-400"}`}
              >
                {code === "fr-CA" ? t("french") : t("english")}
              </button>
            </form>
          ))}
        </nav>
          {session && !session.mfaPending ? (
            <form action={logoutAction}>
              <button type="submit" className={`min-h-11 rounded-md border border-stone-300 px-3 py-1 hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800 ${FOCUS}`}>
                {t("signOut")}
              </button>
            </form>
          ) : null}
        </div>
      </div>
    </header>
  );
}

export async function Footer() {
  const t = await getTranslations("app");
  return (
    <footer className="border-t border-stone-200 py-4 text-center text-xs text-stone-600 dark:border-stone-800 dark:text-stone-400">
      {t("name")} · {t("version", { version: appVersion() })} · {t("license")}
    </footer>
  );
}
