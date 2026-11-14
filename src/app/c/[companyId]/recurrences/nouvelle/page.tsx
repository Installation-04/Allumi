import {randomUUID} from "node:crypto";
import Link from "next/link";
import {notFound} from "next/navigation";
import {getTranslations} from "next-intl/server";
import {can} from "@/modules/companies";
import {recurringSources,getInvoice,recurringDate} from "@/modules/sales";
import {todayIso} from "@/modules/ledger";
import {ActionForm,Field,SelectField} from "@/app/_components/ui";
import {loadCompany} from "../../_lib";
import {validId} from "../../factures/editor";
import {createRecurringAction} from "../actions";
export default async function Page({params,searchParams}:{params:Promise<{companyId:string}>;searchParams:Promise<{facture?:string|string[]}>}) {
 const {company,actor}=await loadCompany(params,"sales.manage");if(!(["contact.read","ledger.read","taxes.read"] as const).every(a=>can(company,a)))notFound();
 const query=await searchParams;if(Array.isArray(query.facture)||query.facture&&!validId(query.facture))notFound();
 const result=await recurringSources(actor);const chosen=query.facture?await getInvoice(actor,query.facture):null;if(query.facture&&(!chosen||chosen.status!=="POSTED"))notFound();
 if(chosen&&!result.sources.some(s=>s.id===chosen.id))result.sources.unshift({id:chosen.id,number:chosen.number,issueDate:chosen.issueDate.toISOString().slice(0,10)});
 const baseDate=chosen&&chosen.issueDate.toISOString().slice(0,10)>todayIso()?chosen.issueDate.toISOString().slice(0,10):todayIso();const anchor=Number((chosen?.issueDate.toISOString().slice(0,10)??baseDate).slice(8));const first=recurringDate(baseDate,1,1,anchor)??baseDate;
 const t=await getTranslations("recurring");
 return <section className="max-w-3xl space-y-5"><Link className="inline-flex min-h-11 items-center underline" href={`/c/${company.id}/recurrences`}>{t("title")}</Link><h1 className="text-2xl font-semibold">{t("new")}</h1><p>{t("intro")}</p><p>{t("sourceHint")}</p>{result.truncated&&<p>{t("sourcesLimit")}</p>}{!result.sources.length?<p>{t("noSources")}</p>:<ActionForm action={createRecurringAction.bind(null,company.id)} label={t("create")} variant="primary"><input type="hidden" name="creationKey" value={randomUUID()} /><SelectField name="sourceInvoiceId" label={t("source")} defaultValue={chosen?.id??""} options={[{value:"",label:t("choose")},...result.sources.map(s=>({value:s.id,label:`${s.number} · ${s.issueDate}`}))]} /><Field name="name" label={t("name")} defaultValue={chosen?.number??""} /><div className="grid gap-4 sm:grid-cols-2"><Field name="startDate" label={t("start")} type="date" defaultValue={first} /><Field name="endDate" label={t("end")} type="date" required={false} /><SelectField name="intervalMonths" label={t("interval")} defaultValue="1" options={([1,3,12] as const).map(n=>({value:String(n),label:t(`intervals.${n}`)}))} /><Field name="anchorDay" label={t("anchor")} inputMode="numeric" defaultValue={String(anchor)} hint={t("anchorHint")} /><Field name="termDays" label={t("term")} inputMode="numeric" defaultValue="30" /></div><p>{t("immutableHint")}</p><label className="inline-flex min-h-11 items-center gap-3"><input type="checkbox" name="confirm" value="yes" required />{t("confirm")}</label></ActionForm>}</section>;
}
