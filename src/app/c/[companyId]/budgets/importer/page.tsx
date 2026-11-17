import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getBudgetImportAccounts } from "@/modules/budgets";
import { listFiscalYears } from "@/modules/ledger";
import { AppError } from "@/platform/errors";
import { loadCompany } from "../../_lib";
import { ImportBudgetForm } from "./form";
export const dynamic="force-dynamic";
export async function generateMetadata(){return {title:(await getTranslations("budgets"))("importTitle")};}
export default async function Page({params}:{params:Promise<{companyId:string}>}){
  const {company,actor,locale}=await loadCompany(params,"budget.manage"),t=await getTranslations("budgets");
  const accounts=await getBudgetImportAccounts(actor).catch(e=>{if(e instanceof AppError&&e.key==="budgets.importChartLimit")return null;throw e;});
  const years=await listFiscalYears(actor);
  return <section className="max-w-4xl space-y-6">
    <Link href={`/c/${company.id}/budgets`} className="inline-flex min-h-11 items-center text-sm text-brand-700 underline dark:text-brand-400">{t("back")}</Link>
    <div><h1 className="text-2xl font-semibold">{t("importTitle")}</h1><p className="mt-2 text-sm text-stone-600 dark:text-stone-400">{t("importIntro")}</p></div>
    {!accounts?<p role="alert">{(await getTranslations("errors"))("budgets.importChartLimit")}</p>:!years.length?<p>{t("noYear")}</p>:<ImportBudgetForm companyId={company.id} accounts={accounts} years={years.map(y=>({id:y.id,start:y.start,end:y.end}))} initialFormat={locale}/>}
  </section>;
}
