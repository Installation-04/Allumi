import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "@/platform/i18n/server";
import { ActionForm,Field,SelectField } from "@/app/_components/ui";
import { FOCUS } from "@/app/_components/focus";
import { getBudgetCopyPreview } from "@/modules/budgets";
import { listFiscalYears,formatMoney } from "@/modules/ledger";
import { AppError } from "@/platform/errors";
import { loadCompany,accountName } from "../../../_lib";
import { duplicateAction } from "../../actions";
export const dynamic="force-dynamic";
export async function generateMetadata(){return {title:(await getTranslations("budgets"))("copyTitle")};}
export default async function Page({params}:{params:Promise<{companyId:string;budgetId:string}>}) {
  const {company,actor,locale}=await loadCompany(params,"budget.manage"),{budgetId}=await params;
  const t=await getTranslations("budgets");
  const copy=await getBudgetCopyPreview(actor,budgetId).catch(e=>{
    if(e instanceof AppError&&e.key==="budgets.notFound")notFound();
    if(e instanceof AppError&&e.key==="budgets.tooMany")return null;
    throw e;
  });
  if(!copy)return <section><h1 className="text-2xl font-semibold">{t("copyTitle")}</h1><p role="alert" className="mt-4">{(await getTranslations("errors"))("budgets.tooMany")}</p></section>;
  const years=await listFiscalYears(actor),path=`/c/${company.id}/budgets/${budgetId}/dupliquer`;
  return <section className="max-w-4xl space-y-6">
    <Link href={`/c/${company.id}/budgets/${budgetId}`} className={`inline-flex min-h-11 items-center text-sm text-brand-700 underline dark:text-brand-400 ${FOCUS}`}>{t("copyBack")}</Link>
    <div><h1 className="text-2xl font-semibold">{t("copyTitle")}</h1><p className="mt-2 text-sm text-stone-600 dark:text-stone-400">{t("copyIntro")}</p></div>
    <Link href={`/c/${company.id}/budgets/${budgetId}/dupliquer/mensuel`} className={`inline-flex min-h-11 items-center underline ${FOCUS}`}>{t("monthlyCopyLink")}</Link>
    <section aria-labelledby="copy-source" className="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
      <h2 id="copy-source" className="text-lg font-semibold">{t("copySource")}</h2><p className="mt-2 break-words font-medium">{copy.source.name}</p><p className="text-sm tabular-nums">{copy.source.from} → {copy.source.to}</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">{([true,false] as const).map(active=><div key={String(active)}><h3 className="font-semibold">{t(active?"copyActive":"copyExcluded",{count:active?copy.activeCount:copy.inactiveCount})}</h3><dl className="mt-2 space-y-2 text-sm">{(["revenue","expenses"] as const).map(k=><div key={k} className="flex flex-wrap justify-between gap-2"><dt>{t(k)}</dt><dd className="font-semibold tabular-nums">{formatMoney(active?(k==="revenue"?copy.activeRevenueCents:copy.activeExpenseCents):(k==="revenue"?copy.inactiveRevenueCents:copy.inactiveExpenseCents),locale)}</dd></div>)}</dl></div>)}</div>
    </section>
    {copy.inactiveCount?<p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">{t("copyInactiveHint")}</p>:null}
    {!copy.activeCount?<p className="text-sm">{t("copyEmpty")}</p>:null}
    <section aria-labelledby="copy-destination" className="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
      <h2 id="copy-destination" className="mb-4 text-lg font-semibold">{t("copyDestination")}</h2>
      <ActionForm action={duplicateAction.bind(null,company.id,budgetId,copy.source.revision,copy.stateToken)} label={t("copyConfirm")} variant="primary" preserveOnReset>
        <Field name="name" label={t("copyName")} autoComplete="off"/>
        <SelectField name="fiscalYearId" label={t("copyYear")} options={years.map(y=>({value:y.id,label:`${y.start} → ${y.end}`}))}/>
        {copy.inactiveCount?<label className="flex min-h-11 items-start gap-3 text-sm"><input type="checkbox" name="skipInactive" value="yes" required className={`mt-1 h-5 w-5 shrink-0 ${FOCUS}`}/><span>{t("copySkip",{count:copy.inactiveCount})}</span></label>:null}
      </ActionForm>
      <p className="mt-4 text-sm text-stone-600 dark:text-stone-400">{t("copyFreshHint")}</p>
      <a href={path} className={`mt-2 inline-flex min-h-11 items-center text-sm text-brand-700 underline dark:text-brand-400 ${FOCUS}`}>{t("copyReload")}</a>
    </section>
    <details className="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900"><summary className="min-h-11 cursor-pointer font-semibold">{t("copyTargets",{count:copy.targets.length})}</summary><ul className="mt-3 divide-y divide-stone-200 dark:divide-stone-800">{copy.targets.map(r=><li key={r.accountId} className="flex flex-wrap items-start justify-between gap-2 py-3 text-sm"><div><p className="break-words font-medium">{r.code} · {accountName(r,locale)}</p><p className="mt-1 text-xs text-stone-600 dark:text-stone-400">{t(r.type==="REVENUE"?"revenue":"expenses")} · {t(r.isActive?"copyWillCopy":"copyWillSkip")}</p></div><p className="font-semibold tabular-nums">{formatMoney(r.amountCents,locale)}</p></li>)}</ul></details>
  </section>;
}
