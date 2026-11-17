import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ActionForm, Field, SelectField } from "@/app/_components/ui";
import { can } from "@/modules/companies";
import { listFiscalYears } from "@/modules/ledger";
import { listBudgets } from "@/modules/budgets";
import { loadCompany } from "../_lib";
import { createAction } from "./actions";
export const dynamic="force-dynamic";
export async function generateMetadata(){return {title:(await getTranslations("budgets"))("title")};}
export default async function Page({params}:{params:Promise<{companyId:string}>}) {
  const {company,actor}=await loadCompany(params,"ledger.read");const t=await getTranslations("budgets");
  const [budgets,years]=await Promise.all([listBudgets(actor),listFiscalYears(actor)]);
  return <section className="space-y-6">
    <div><h1 className="text-2xl font-semibold">{t("title")}</h1><p className="mt-2 text-sm text-stone-600 dark:text-stone-400">{t("intro")}</p></div>
    {can(company,"budget.manage") && years.length>0 ? <section className="max-w-xl rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900" aria-labelledby="new-budget">
      <h2 id="new-budget" className="mb-4 text-lg font-semibold">{t("create")}</h2>
      <ActionForm action={createAction.bind(null,company.id)} label={t("create")} variant="primary">
        <Field name="name" label={t("name")} autoComplete="off" />
        <SelectField name="fiscalYearId" label={t("year")} options={years.map(y=>({value:y.id,label:`${y.start} → ${y.end}`}))} />
      </ActionForm>
    </section>:null}
    {years.length===0 ? <p>{t("noYear")}</p>:null}
    <section aria-labelledby="budget-list"><h2 id="budget-list" className="mb-3 text-lg font-semibold">{t("scenarios")}</h2>
      {budgets.length ? <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{budgets.map(b=><li key={b.id}><Link className="block rounded-lg border border-stone-200 bg-white p-4 hover:border-brand-600 focus-visible:outline-2 focus-visible:outline-brand-600 dark:border-stone-700 dark:bg-stone-900" href={`/c/${company.id}/budgets/${b.id}`}><span className="block break-words font-semibold">{b.name}</span><span className="mt-2 block text-sm text-stone-600 dark:text-stone-400">{b.from} → {b.to}</span></Link></li>)}</ul>:<p>{t("empty")}</p>}
    </section>
  </section>;
}
