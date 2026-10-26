import { getProfile } from "@/modules/auth";
import { cookies } from "next/headers";
import { isTheme } from "@/app/_lib/theme";
import { ThemePicker } from "./theme-picker";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { logoutAction } from "@/app/connexion/actions";
import { setLocale } from "@/app/langue/actions";
import { appVersion } from "@/platform/version";
import { FOCUS } from "./focus";
import { getSession } from "@/app/_lib/session";
import { Logo } from "./logo";

export async function Header({ global = false, companyName }: { global?: boolean; companyName?: string }) {
  const t = await getTranslations("common");
  const locale = await getLocale();
  const session = await getSession();
  const preference = (await cookies()).get("allumi_theme")?.value;
  const profile = session && !session.mfaPending ? await getProfile(session.userId) : null;
  return (
    <header className={`${global ? "global-header" : "workspace-header"} border-b border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900`}>
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-1 sm:px-6">
        {companyName ? <Link href="/" className={`min-w-0 max-w-full rounded py-3 text-sm font-medium ${FOCUS}`}>{companyName}</Link> : (
        <Link href="/" className={`inline-flex min-h-11 items-center gap-2 rounded-sm text-xl font-bold text-brand-700 dark:text-brand-500 ${FOCUS}`}>
          <Logo size={36} />
          Allumi
        </Link>
        )}
        <div className="flex flex-wrap items-center gap-3 text-sm">
        {(profile?.isInstanceAdmin || profile?.canManageServer) && <Link href="/administration/serveur" className={`inline-flex min-h-11 items-center underline ${FOCUS}`}>{(await getTranslations("server"))("shortTitle")}</Link>}
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
          <ThemePicker value={isTheme(preference) ? preference : "system"} />
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
      {t("name")} · {t("license")} · <Link className="inline-flex min-h-11 items-center underline" href="/versions">{t("version", { version: appVersion() })} ↗</Link>
    </footer>
  );
}
