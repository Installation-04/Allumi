import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { loadCompany, accountName } from "../_lib";
import { can } from "@/modules/companies";
import { listAccounts, todayIso } from "@/modules/ledger";
import { getOfficialTaxPreview, PROVINCES, COVERAGE_FROM, CRA_PAGE, RQ_URL, officialScope, type OfficialPreview } from "@/modules/taxes";
import { AppError } from "@/platform/errors";
import { FOCUS } from "@/app/_components/focus";
import { ActionForm, Field, SelectField } from "@/app/_components/ui";
import { importAction } from "./actions";
export const dynamic="force-dynamic";
export async function generateMetadata(){return{title:(await getTranslations("officialTaxes"))("title")};}
export default async function Page({params,searchParams}:{params:Promise<{companyId:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const {actor,company,locale}=await loadCompany(params,"taxes.read"),query=await searchParams,t=await getTranslations("officialTaxes");
  for(const key of ["province","date","charger"])if(Array.isArray(query[key]))notFound();
  const province=(query.province as string|undefined)??"QC",date=(query.date as string|undefined)??todayIso();
  try{officialScope(province,date,todayIso());}catch{notFound();}
  if(query.charger!==undefined&&query.charger!=="1")notFound();
  let preview:OfficialPreview|null=null,error:string|null=null;
  if(query.charger==="1")try{preview=await getOfficialTaxPreview(actor,province,date);}catch(e){if(e instanceof AppError&&["officialTaxes.unavailable","officialTaxes.schema"].includes(e.key))error=e.key;else throw e;}
  const manage=can(company,"taxes.manage")&&can(company,"ledger.read"),accounts=manage&&preview?await listAccounts(actor):[];
  const options=(type:"ASSET"|"LIABILITY")=>[{value:"",label:t("none")},...accounts.filter(a=>a.isActive&&a.type===type&&a.subtype==="SALES_TAX").map(a=>({value:a.id,label:`${a.code} — ${accountName(a,locale)}`}))];
  const control=`min-h-11 min-w-0 w-full rounded border border-stone-300 bg-white px-3 dark:border-stone-700 dark:bg-stone-900 ${FOCUS}`;
  const panel="min-w-0 rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-900";
  const percent=(value:string)=>locale==="en"?value:value.replace(".",",");
  return <section className="min-w-0 space-y-5 [overflow-wrap:anywhere]">
    <Link className={`inline-flex min-h-11 items-center underline ${FOCUS}`} href={`/c/${company.id}/taxes`}>{t("back")}</Link>
    <h1 className="text-2xl font-semibold">{t("title")}</h1><p>{t("intro")}</p>
    <form method="get" aria-label={t("consult")} className={`${panel} grid gap-3 sm:grid-cols-3`}>
      <input type="hidden" name="charger" value="1" />
      <div><label htmlFor="official-province">{t("province")}</label><select id="official-province" name="province" defaultValue={province} className={control}>{PROVINCES.map(code=><option key={code} value={code}>{t(`provinces.${code}`)}</option>)}</select></div>
      <label className="min-w-0">{t("date")}<input type="date" name="date" min={COVERAGE_FROM} max={todayIso()} required defaultValue={date} className={control} /></label>
      <button type="submit" className={`min-h-11 self-end rounded bg-brand-700 px-4 text-white ${FOCUS}`}>{t("consult")}</button>
    </form>
    {error&&<p role="alert">{(await getTranslations("errors"))(error as "officialTaxes.unavailable")}</p>}
    {preview&&<>
      <h2 className="text-xl font-semibold">{t("results",{province:t(`provinces.${preview.province}`),date:preview.date})}</h2>
      <p className="text-sm text-stone-600 dark:text-stone-400">{t("coverage")}</p>
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">{preview.sources.map(source=>{
        const current=source.rates.find(r=>r.from<=date&&(!r.to||r.to>=date))!;
        return <article className={`${panel} space-y-3`} key={source.id}>
          <h3 className="font-semibold">{t(`providers.${source.id}`)}</h3><p className="text-2xl font-semibold tabular-nums">{percent(current.percent)} %</p>
          <p className="text-sm">{t("collected",{date:source.collectedAt.slice(0,19).replace("T"," ")+" UTC"})}</p>
          <Link href={source.id==="CRA_GST_HST"?CRA_PAGE:RQ_URL} className={`inline-flex min-h-11 items-center text-brand-700 underline dark:text-brand-500 ${FOCUS}`}>{t("officialSource")}</Link>
          <details><summary className={`min-h-11 cursor-pointer py-2 ${FOCUS}`}>{t("history")}</summary><ul className="space-y-2 text-sm">{source.rates.map(rate=><li key={rate.from}>{rate.from} → {rate.to??t("ongoing")} · {percent(rate.percent)} %</li>)}</ul><p className="mt-3 break-all font-mono text-xs">SHA-256 : {source.sha256}</p></details>
        </article>;
      })}</div>
      {manage?<section className={`${panel} space-y-4`}><h2 className="text-xl font-semibold">{t("create")}</h2><p className="text-sm">{t("importHelp")}</p>
        <ActionForm action={importAction.bind(null,company.id)} label={t("create")} variant="primary">
          <input type="hidden" name="province" value={preview.province}/><input type="hidden" name="date" value={preview.date}/><input type="hidden" name="fingerprint" value={preview.fingerprint}/>
          <div className="grid min-w-0 gap-4 sm:grid-cols-2"><Field name="code" label={t("code")} defaultValue={`${province}-STD`} hint={t("codeHint")}/><div/>
            <SelectField name="federalPayable" label={t("federalPayable")} options={options("LIABILITY")}/><SelectField name="federalRecoverable" label={t("federalRecoverable")} options={options("ASSET")} required={false}/>
            {province==="QC"?<><SelectField name="qstPayable" label={t("qstPayable")} options={options("LIABILITY")}/><SelectField name="qstRecoverable" label={t("qstRecoverable")} options={options("ASSET")} required={false}/></>:<><input type="hidden" name="qstPayable" value=""/><input type="hidden" name="qstRecoverable" value=""/></>}
          </div>
          <label className="flex min-h-11 items-start gap-3 py-2"><input className="mt-1" type="checkbox" name="confirmed" value="yes" required/><span>{t("confirm")}</span></label>
        </ActionForm>
      </section>:<p>{t("readOnly")}</p>}
    </>}
  </section>;
}
