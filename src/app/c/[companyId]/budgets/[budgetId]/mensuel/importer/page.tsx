import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "@/platform/i18n/server";
import { getMonthlyBudgetImportState } from "@/modules/budgets";
import { AppError } from "@/platform/errors";
import { FOCUS } from "@/app/_components/focus";
import { loadCompany } from "../../../../_lib";
import { MonthlyImportForm } from "./form";
export const dynamic="force-dynamic";
export async function generateMetadata(){return {title:(await getTranslations("budgets"))("monthlyImportTitle")};}
export default async function Page({params}:{params:Promise<{companyId:string;budgetId:string}>}){
 const {company,actor,locale}=await loadCompany(params,"budget.manage"),{budgetId}=await params,t=await getTranslations("budgets");
 const state=await getMonthlyBudgetImportState(actor,budgetId).catch(e=>{if(e instanceof AppError&&["budgets.notFound","budgets.invalid"].includes(e.key))notFound();if(e instanceof AppError&&["budgets.tooMany","budgets.monthlyPeriods","budgets.monthlyExcess"].includes(e.key))return e;throw e;});
 const path=`/c/${company.id}/budgets/${budgetId}/mensuel`;
 return <section className="max-w-5xl space-y-6">
  <Link href={path} className={`inline-flex min-h-11 items-center text-sm underline ${FOCUS}`}>{t("monthlyTitle")}</Link>
  <div><h1 className="text-2xl font-semibold">{t("monthlyImportTitle")}</h1><p className="mt-2 text-sm text-stone-600 dark:text-stone-400">{t("monthlyImportIntro")}</p></div>
  {state instanceof AppError?<p role="alert">{(await getTranslations("errors"))(state.key as "budgets.tooMany")}</p>:<>
   <section aria-labelledby="monthly-import-destination" className="space-y-3 rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900"><h2 id="monthly-import-destination" className="text-lg font-semibold">{t("monthlyImportDestination")}</h2><p className="break-words font-medium">{state.name}</p><p className="tabular-nums">{state.from} → {state.to}</p><p className="text-sm">{t("monthlyImportScope")}</p>
   <details><summary className={`min-h-11 cursor-pointer font-medium ${FOCUS}`}>{t("monthlyImportPeriods")}</summary><ol className="mt-3 grid gap-3 sm:grid-cols-2">{state.periods.map(p=><li key={p.id} className="rounded-md border border-stone-200 p-3 text-sm dark:border-stone-700"><h3 className="font-semibold">period_{p.number}</h3><p className="mt-1 tabular-nums">{p.from} → {p.to}</p></li>)}</ol></details></section>
   <MonthlyImportForm companyId={company.id} budgetId={budgetId} snapshot={state} initialFormat={locale}/>
  </>}
 </section>;
}
