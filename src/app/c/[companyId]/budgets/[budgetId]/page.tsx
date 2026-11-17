import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ActionForm, Field, SelectField } from "@/app/_components/ui";
import { TABLE_CLASS,TH_CLASS,TD_CLASS } from "@/app/_components/table";
import { can } from "@/modules/companies";
import { formatMoney,listAccounts } from "@/modules/ledger";
import { getBudgetComparison } from "@/modules/budgets";
import { AppError } from "@/platform/errors";
import { loadCompany,accountName } from "../../_lib";
import { saveTargetAction,removeTargetAction } from "../actions";
export const dynamic="force-dynamic";
export async function generateMetadata(){return {title:(await getTranslations("budgets"))("title")};}
export default async function Page({params}:{params:Promise<{companyId:string;budgetId:string}>}) {
  const {company,actor,locale}=await loadCompany(params,"ledger.read");const {budgetId}=await params;
  const t=await getTranslations("budgets");
  const report=await getBudgetComparison(actor,budgetId).catch(e=>{if(e instanceof AppError && e.key==="budgets.notFound") notFound();if(e instanceof AppError && e.key==="budgets.tooMany")return null;throw e;});
  if(!report)return <section><h1 className="text-2xl font-semibold">{t("title")}</h1><p role="alert" className="mt-4">{(await getTranslations("errors"))("budgets.tooMany")}</p></section>;
  const edit=can(company,"budget.manage");const path=`/c/${company.id}/budgets/${budgetId}`;
  const targets=new Set(report.rows.filter(r=>r.targetCents!==null).map(r=>r.accountId));
  const accounts=edit ? (await listAccounts(actor,{includeInactive:true})).filter(a=>(a.type==="REVENUE"||a.type==="EXPENSE")&&(a.isActive||targets.has(a.id))) : [];
  const unbudgeted=report.revenue.unbudgeted+report.expenses.unbudgeted;
  return <section className="space-y-6">
    <Link href={`/c/${company.id}/budgets`} className="text-sm text-brand-700 underline dark:text-brand-400">{t("back")}</Link>
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="break-words text-2xl font-semibold">{report.name}</h1><p className="mt-1 text-sm tabular-nums">{report.from} → {report.to}</p></div><a href={`${path}/export`} className="inline-flex min-h-11 items-center rounded-md border border-stone-300 px-4 text-sm dark:border-stone-700">{t("export")}</a></div>
    <p className="text-sm text-stone-600 dark:text-stone-400">{t("scope")}</p>
    {unbudgeted ? <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">{t("coverage",{count:unbudgeted})}</p>:null}
    <div className="grid gap-4 sm:grid-cols-2">{(["revenue","expenses"] as const).map(k=><article key={k} className="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900"><h2 className="font-semibold">{t(k)}</h2><dl className="mt-3 space-y-2 text-sm"><div className="flex flex-wrap justify-between gap-2"><dt>{t("definedTargets")}</dt><dd className="font-semibold tabular-nums">{formatMoney(report[k].targetCents,locale)}</dd></div><div className="flex flex-wrap justify-between gap-2"><dt>{t("actual")}</dt><dd className="font-semibold tabular-nums">{formatMoney(report[k].actualCents,locale)}</dd></div></dl></article>)}</div>
    {edit && accounts.length ? <details className="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900"><summary className="min-h-11 cursor-pointer font-semibold">{t("saveTarget")}</summary><div className="mt-3 max-w-xl"><ActionForm action={saveTargetAction.bind(null,company.id,budgetId,report.revision)} label={t("saveTarget")} savedMessage={t("saved")} variant="primary"><SelectField name="accountId" label={t("account")} options={accounts.map(a=>({value:a.id,label:`${a.code} · ${accountName(a,locale)}${a.isActive?"":` (${t("inactive")})`}`}))}/><Field name="amount" label={t("amount")} inputMode="decimal" autoComplete="off" hint={t("amountHint")}/></ActionForm><p className="mt-3 text-sm text-stone-600 dark:text-stone-400">{t("editHint")}</p></div></details>:null}
    <section aria-labelledby="budget-comparison"><h2 id="budget-comparison" className="mb-3 text-lg font-semibold">{t("comparison")}</h2><p className="mb-3 text-sm text-stone-600 dark:text-stone-400">{t("differenceHint")}</p>
    {report.rows.length ? <>
      <ul className="space-y-3 sm:hidden">{report.rows.map(r=><li key={r.accountId} className="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
        <h3 className="break-words font-semibold">{r.code} · {accountName(r,locale)}</h3><p className="mt-1 text-xs text-stone-600 dark:text-stone-400">{t(r.type==="REVENUE"?"revenue":"expenses")}{!r.isActive?` · ${t("inactive")}`:""}</p>
        <dl className="my-4 space-y-3 text-sm">{(["target","actual","difference"] as const).map(k=><div key={k} className="flex flex-wrap justify-between gap-2"><dt>{t(k)}</dt><dd className="font-semibold tabular-nums">{k==="target"?(r.targetCents===null?t("notSet"):formatMoney(r.targetCents,locale)):k==="actual"?formatMoney(r.actualCents,locale):r.differenceCents===null?"—":formatMoney(r.differenceCents,locale)}</dd></div>)}</dl>
        {edit&&r.targetCents!==null?<ActionForm action={removeTargetAction.bind(null,company.id,budgetId,r.accountId,report.revision)} label={t("remove")} ariaLabel={t("removeNamed",{code:r.code})} savedMessage={t("removed")}/>:null}
      </li>)}</ul>
      <div className="hidden overflow-x-auto sm:block"><table className={TABLE_CLASS}><caption className="sr-only">{t("comparison")}</caption><thead><tr>{(["account","type","target","actual","difference",...(edit?["actions" as const]:[])] as const).map(k=><th key={k} scope="col" className={TH_CLASS}>{t(k)}</th>)}</tr></thead><tbody>{report.rows.map(r=><tr key={r.accountId}><th scope="row" className={`${TD_CLASS} text-left font-medium`}><span className="block">{r.code} · {accountName(r,locale)}</span>{!r.isActive?<span className="text-xs text-stone-500">{t("inactive")}</span>:null}</th><td className={TD_CLASS}>{t(r.type==="REVENUE"?"revenue":"expenses")}</td><td className={`${TD_CLASS} whitespace-nowrap tabular-nums`}>{r.targetCents===null?t("notSet"):formatMoney(r.targetCents,locale)}</td><td className={`${TD_CLASS} whitespace-nowrap tabular-nums`}>{formatMoney(r.actualCents,locale)}</td><td className={`${TD_CLASS} whitespace-nowrap tabular-nums`}>{r.differenceCents===null?"—":formatMoney(r.differenceCents,locale)}</td>{edit?<td className={TD_CLASS}>{r.targetCents!==null?<ActionForm action={removeTargetAction.bind(null,company.id,budgetId,r.accountId,report.revision)} label={t("remove")} ariaLabel={t("removeNamed",{code:r.code})} savedMessage={t("removed")}/>:null}</td>:null}</tr>)}</tbody></table></div></>:<p>{t("noTargets")}</p>}
    </section>
    <a href={path} className="inline-flex min-h-11 items-center text-sm text-brand-700 underline dark:text-brand-400">{t("reload")}</a>
  </section>;
}
