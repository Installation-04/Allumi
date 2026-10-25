import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ActionForm, Card } from "@/app/_components/ui";
import { Icon } from "@/app/_components/icon";
import { FOCUS } from "@/app/_components/focus";
import { can } from "@/modules/companies";
import { formatMoney, getTrialBalance, ledgerStatus, listEntries, totalsByType } from "@/modules/ledger";
import { initializeLedgerAction } from "./actions";
import { loadCompany } from "./_lib";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return { title: (await getTranslations("dashboard"))("pageTitle") };
}

const PANEL = "rounded-lg lg:rounded-none border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900 sm:p-5";

export default async function CompanyPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { company, actor, locale } = await loadCompany(params);
  const [t, tn, ts] = await Promise.all([getTranslations("dashboard"), getTranslations("nav"), getTranslations("ledgerSetup")]);
  const status = await ledgerStatus(actor);
  const base = `/c/${company.id}`;
  const data = status.initialized ? await Promise.all([getTrialBalance(actor), listEntries(actor)]) : null;
  const trial = data?.[0];
  const journal = data?.[1];
  const totals = trial ? totalsByType(trial.lines, trial.lines.map((line) => ({ id: line.accountId, type: line.type }))) : null;
  const healthy = trial?.balanced && trial.equationHolds;
  const sections = [
    { href: `${base}/comptes`, title: tn("accounts"), hint: t("accountsHint"), icon: "accounts" as const },
    { href: `${base}/exercices`, title: tn("fiscal"), hint: t("fiscalHint"), icon: "fiscal" as const },
    ...(can(company, "audit.read") ? [{ href: `${base}/audit`, title: tn("audit"), hint: t("auditHint"), icon: "audit" as const }] : []),
  ];

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-brand-700 dark:text-brand-500">{t("pageTitle")}</p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-2xl">{t("title", { company: company.name })}</h1>
          <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">{t("role", { role: t(`roles.${company.role}`) })}</p>
        </div>

        {status.initialized && can(company, "entry.post") ? <Link href={`${base}/journal/nouvelle`} className={`inline-flex min-h-11 items-center gap-2 rounded-full bg-brand-700 px-4 py-2 text-sm font-semibold text-white lg:hidden ${FOCUS}`}><Icon name="plus" />{t("newEntry")}</Link> : null}
      </div>

      {totals && journal ? (
        <>
          <div>
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold">{t("financialOverview")}</h2>
              <p className="text-xs text-stone-500 dark:text-stone-400">{t("allDates")}</p>
            </div>
            <dl className="grid grid-cols-2 gap-3 lg:gap-1 lg:grid-cols-4">
              {([
                ["assets", totals.ASSET], ["liabilities", totals.LIABILITY],
                ["revenue", totals.REVENUE], ["expenses", totals.EXPENSE],
              ] as const).map(([label, amount]) => (
                <div key={label} className={`summary-tile summary-${label} min-w-0 rounded-lg border border-stone-200 px-4 py-4 lg:rounded-none lg:border-0`}>
                  <dt className="text-xs font-semibold uppercase tracking-wide">{t(label)}</dt>
                  <dd className="mt-2 text-xl font-semibold tracking-tight tabular-nums" data-testid={`dashboard-${label}`}>{formatMoney(amount, locale)}</dd>
                  <dd className="mt-1 text-xs">{t("ledgerBalance")}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <section className={`${PANEL} min-w-0`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold">{t("recentEntries")}</h2>
                <Link href={`${base}/journal`} className={`inline-flex min-h-11 items-center gap-2 rounded text-sm font-semibold text-brand-700 dark:text-brand-500 ${FOCUS}`}>
                  {t("viewJournal")}<Icon name="arrow" className="h-4 w-4" />
                </Link>
              </div>
              {journal.entries.length ? (
                <ul className="mt-2 divide-y divide-stone-100 dark:divide-stone-800">
                  {journal.entries.slice(0, 5).map((entry) => (
                    <li key={entry.id}>
                      <Link href={`${base}/journal/${entry.id}`} className={`flex min-h-11 flex-wrap items-center justify-between gap-3 py-3 hover:bg-stone-50 dark:hover:bg-stone-800 ${FOCUS}`}>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold">{entry.memo || entry.numberLabel}</span>
                          <span className="mt-1 block text-xs text-stone-500 dark:text-stone-400">{entry.numberLabel} · <time dateTime={entry.date}>{entry.date}</time></span>
                        </span>
                        <span className="text-sm font-semibold tabular-nums">{formatMoney(entry.totalCents, locale)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="my-6 border border-dashed border-stone-300 px-5 py-8 text-center dark:border-stone-700">
                  <Icon name="journal" className="mx-auto mb-3 h-8 w-8 text-brand-700 dark:text-brand-500" />
                  <p className="font-semibold">{t("emptyTitle")}</p>
                  <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">{t("emptyHint")}</p>
                </div>
              )}
            </section>
            <section className={PANEL}>
              <div className="mb-3 flex items-center gap-3">
                <span className="rounded-xl bg-brand-50 p-3 text-brand-700 dark:bg-brand-800 dark:text-white"><Icon name="trial" /></span>
                <h2 className="text-lg font-semibold">{t("ledgerHealth")}</h2>
              </div>
              <p className={`text-sm font-semibold ${healthy ? "text-brand-700 dark:text-brand-500" : "text-red-700 dark:text-red-400"}`}>{healthy ? t("balanced") : t("needsReview")}</p>
              <p className="mt-2 text-sm leading-relaxed text-stone-500 dark:text-stone-400">{t("healthHint")}</p>
              <dl className="my-3 space-y-3 border-y border-stone-100 py-4 text-sm dark:border-stone-800">
                <div className="flex justify-between gap-3"><dt>{t("postedEntries")}</dt><dd className="font-semibold tabular-nums">{journal.total}</dd></div>
                <div className="flex justify-between gap-3"><dt>{tn("accounts")}</dt><dd className="font-semibold tabular-nums">{status.accounts}</dd></div>
              </dl>
              <Link href={`${base}/balance`} className={`inline-flex min-h-11 items-center gap-2 rounded text-sm font-semibold text-brand-700 dark:text-brand-500 ${FOCUS}`}>{tn("trial")}<Icon name="arrow" className="h-4 w-4" /></Link>
            </section>
          </div>

          <section>
            <h2 className="mb-3 text-lg font-semibold">{t("tools")}</h2>
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {sections.map((section) => (
                <li key={section.href}>
                  <Link href={section.href} className={`block h-full ${PANEL} transition-colors hover:border-brand-600 ${FOCUS}`}>
                    <Icon name={section.icon} className="mb-4 h-6 w-6 text-brand-700 dark:text-brand-500" />
                    <span className="block text-sm font-semibold">{section.title}</span>
                    <span className="mt-2 block text-sm leading-relaxed text-stone-500 dark:text-stone-400">{section.hint}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : (
        <Card title={ts("title")} headingLevel={2}>
          <p className="text-sm">{ts("intro")}</p>
          {can(company, "account.manage") ? <ActionForm action={initializeLedgerAction.bind(null, company.id)} label={ts("submit")} variant="primary" /> : <p className="text-sm">{ts("notAllowed")}</p>}
        </Card>
      )}
      <Link href="/compte/securite" className={`inline-flex min-h-11 items-center rounded text-sm text-stone-600 underline dark:text-stone-400 ${FOCUS}`}>{t("security")}</Link>
    </section>
  );
}
