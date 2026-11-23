import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "@/platform/i18n/server";
import { ActionForm, Field, SelectField } from "@/app/_components/ui";
import { FOCUS } from "@/app/_components/focus";
import { getMonthlyBudgetCopyPreview } from "@/modules/budgets";
import { listFiscalYears, formatMoney } from "@/modules/ledger";
import { AppError } from "@/platform/errors";
import { loadCompany, accountName } from "../../../../_lib";
import { duplicateMonthlyAction } from "../../../actions";

export const dynamic = "force-dynamic";
export async function generateMetadata() { return { title: (await getTranslations("budgets"))("monthlyCopyTitle") }; }
export default async function Page({ params, searchParams }: { params: Promise<{ companyId: string; budgetId: string }>; searchParams: Promise<{ exercice?: string | string[] }> }) {
  const { company, actor, locale } = await loadCompany(params,"budget.manage"), { budgetId } = await params, q = await searchParams, t = await getTranslations("budgets");
  if (Array.isArray(q.exercice)) notFound();
  const copy = await getMonthlyBudgetCopyPreview(actor,budgetId,q.exercice).catch(e => {
    if (e instanceof AppError && ["budgets.notFound","budgets.invalid","budgets.year"].includes(e.key)) notFound();
    if (e instanceof AppError && ["budgets.tooMany","budgets.monthlyPeriods","budgets.monthlyExcess"].includes(e.key)) return e;
    throw e;
  });
  if (copy instanceof AppError) return <section><h1 className="text-2xl font-semibold">{t("monthlyCopyTitle")}</h1><p role="alert" className="mt-4">{(await getTranslations("errors"))(copy.key as "budgets.monthlyPeriods")}</p></section>;
  const path = `/c/${company.id}/budgets/${budgetId}/dupliquer/mensuel`;
  const years = copy.destination ? [] : await listFiscalYears(actor);
  return <section className="max-w-5xl space-y-6">
    <Link href={`/c/${company.id}/budgets/${budgetId}/dupliquer`} className={`inline-flex min-h-11 items-center text-sm underline ${FOCUS}`}>{t("monthlyCopyBack")}</Link>
    <div><h1 className="text-2xl font-semibold">{t("monthlyCopyTitle")}</h1><p className="mt-2 max-w-4xl text-sm text-stone-600 dark:text-stone-400">{t("monthlyCopyIntro")}</p></div>
    <section aria-labelledby="monthly-copy-source" className="space-y-3 rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
      <h2 id="monthly-copy-source" className="text-lg font-semibold">{t("copySource")}</h2><p className="break-words font-medium">{copy.source.name}</p><p className="text-sm tabular-nums">{copy.source.from} → {copy.source.to}</p>
      <p className="text-sm">{t("monthlyCopyCounts",{accounts:copy.activeCount,months:copy.monthlyCount})}</p>
      <dl className="grid gap-3 sm:grid-cols-2">{([["monthlyCopyAnnualRevenue",copy.annualRevenueCents],["monthlyCopyAnnualExpenses",copy.annualExpenseCents],["monthlyCopyRevenue",copy.monthlyRevenueCents],["monthlyCopyExpenses",copy.monthlyExpenseCents]] as const).map(([label,value]) => <div key={label} className="rounded-md border border-stone-200 p-3 dark:border-stone-700"><dt className="text-sm">{t(label)}</dt><dd className="mt-1 font-semibold tabular-nums">{formatMoney(value,locale)}</dd></div>)}</dl>
      {copy.inactiveCount ? <p className="rounded-md border border-amber-300 p-3 text-sm">{t("monthlyCopyExcluded",{accounts:copy.inactiveCount,months:copy.excludedMonthlyCount})}</p> : null}
      {!copy.monthlyCount ? <p className="text-sm">{t("monthlyCopyEmpty")}</p> : null}
    </section>
    {!copy.destination ? <section className="space-y-3 rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
      <h2 className="text-lg font-semibold">{t("copyDestination")}</h2>
      <form method="get" action={path} className="space-y-3"><SelectField name="exercice" label={t("copyYear")} defaultValue="" options={[{value:"",label:t("monthlyCopyChooseYear")},...years.map(y=>({value:y.id,label:`${y.start} → ${y.end}`}))]}/><button className={`min-h-11 rounded-md bg-brand-700 px-4 py-2 text-white ${FOCUS}`}>{t("monthlyCopyPreview")}</button></form>
    </section> : <>
      <section aria-labelledby="monthly-copy-periods" className="space-y-4 rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
        <h2 id="monthly-copy-periods" className="text-lg font-semibold">{t("monthlyCopyPeriods")}</h2><p className="font-medium tabular-nums">{copy.destination.from} → {copy.destination.to}</p><p className="text-sm">{t("monthlyCopyPeriodHint")}</p>
        <ol className="grid gap-3 sm:grid-cols-2">{copy.mapping.map(p=><li key={p.number} className="space-y-2 rounded-md border border-stone-200 p-3 text-sm dark:border-stone-700"><h3 className="font-semibold">{t("monthlyCopyPeriod",{number:p.number})}</h3><dl className="space-y-2"><div><dt className="text-stone-600 dark:text-stone-400">{t("copySource")}</dt><dd className="tabular-nums">{p.source.from} → {p.source.to}</dd></div><div><dt className="text-stone-600 dark:text-stone-400">{t("copyDestination")}</dt><dd className="tabular-nums">{p.destination.from} → {p.destination.to}</dd></div></dl></li>)}</ol>
        <Link href={path} className={`inline-flex min-h-11 items-center underline ${FOCUS}`}>{t("monthlyCopyChangeYear")}</Link>
      </section>
      <section aria-labelledby="monthly-copy-confirm" className="space-y-3 rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
        <h2 id="monthly-copy-confirm" className="text-lg font-semibold">{t("monthlyCopyReview")}</h2>
        <ActionForm action={duplicateMonthlyAction.bind(null,company.id,budgetId,copy.destination.id,copy.source.revision,copy.stateToken)} label={t("monthlyCopyConfirm")} pendingLabel={t("monthlyCopyWorking")} variant="primary" preserveOnReset>
          <Field name="name" label={t("copyName")} autoComplete="off"/>
          {copy.inactiveCount ? <label className="flex min-h-11 items-start gap-3 text-sm"><input type="checkbox" name="skipInactive" value="yes" required className={`mt-1 h-5 w-5 shrink-0 ${FOCUS}`}/><span>{t("monthlyCopySkip",{accounts:copy.inactiveCount,months:copy.excludedMonthlyCount})}</span></label> : null}
          <label className="flex min-h-11 items-start gap-3 text-sm"><input type="checkbox" name="confirmed" value="yes" required className={`mt-1 h-5 w-5 shrink-0 ${FOCUS}`}/><span>{t("monthlyCopyConsent")}</span></label>
        </ActionForm>
        <p className="text-sm text-stone-600 dark:text-stone-400">{t("copyFreshHint")}</p><a href={`${path}?exercice=${copy.destination.id}`} className={`inline-flex min-h-11 items-center underline ${FOCUS}`}>{t("copyReload")}</a>
      </section>
    </>}
    <details className="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900"><summary className={`min-h-11 cursor-pointer font-semibold ${FOCUS}`}>{t("copyTargets",{count:copy.targets.length})}</summary><ul className="mt-3 space-y-4">{copy.targets.map(r=><li key={r.accountId} className="space-y-2 rounded-md border border-stone-200 p-3 text-sm dark:border-stone-700"><h3 className="break-words font-semibold">{r.code} · {accountName(r,locale)}</h3><p>{t(r.isActive?"copyWillCopy":"copyWillSkip")}</p><p>{t("monthlyCopyTarget",{annual:formatMoney(r.amountCents,locale),allocated:formatMoney(r.allocatedCents,locale),remaining:formatMoney(r.remainingCents,locale),count:r.months.length})}</p><ul className="space-y-1">{r.months.map(m=><li key={m.periodId}>{t("monthlyCopyAmount",{number:m.number,amount:formatMoney(m.amountCents,locale)})}</li>)}</ul></li>)}</ul></details>
  </section>;
}
