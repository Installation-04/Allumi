"use client";
import { useId,useMemo,useRef,useState } from "react";
import { useLocale,useTranslations } from "@/platform/i18n/client";
import { StateError,SubmitButton,useScopedAction } from "@/app/_components/ui";
import { FOCUS } from "@/app/_components/focus";
import { formatMoney } from "@/modules/ledger/client";
import { BudgetCsvError,decodeBudgetCsv,MAX_BUDGET_CSV_BYTES,MonthlyCsvError,monthlyImportReview,previewMonthlyBudgetCsv,type BudgetCsvFormat,type MonthlyCsvIssue } from "@/modules/budgets/client";
import type { MonthlyBudgetImportState } from "@/modules/budgets";
import { importMonthsCsvAction } from "../../../actions";
const CONTROL=`min-h-11 min-w-0 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-base dark:border-stone-700 dark:bg-stone-900 ${FOCUS}`;
export function MonthlyImportForm({companyId,budgetId,snapshot,initialFormat}:{companyId:string;budgetId:string;snapshot:MonthlyBudgetImportState;initialFormat:BudgetCsvFormat}){
 const t=useTranslations("budgets"),locale=useLocale()==="en"?"en":"fr-CA",id=useId(),sequence=useRef(0),path=`/c/${companyId}/budgets/${budgetId}/mensuel/importer`;
 const [format,setFormat]=useState(initialFormat),[text,setText]=useState<string|null>(null),[reading,setReading]=useState(false),[fileError,setFileError]=useState<MonthlyCsvIssue|null>(null),[reviewedKey,setReviewedKey]=useState<string|null>(null);
 const {state,formAction}=useScopedAction(importMonthsCsvAction.bind(null,companyId,budgetId,snapshot.revision,snapshot.stateToken));
 const read=useMemo(()=>{if(text===null)return null;try{return {ok:true as const,rows:previewMonthlyBudgetCsv(text,format,snapshot.accounts)};}catch(e){return {ok:false as const,error:e instanceof MonthlyCsvError?e:new MonthlyCsvError("syntax")};}},[text,format,snapshot.accounts]);
 const rows=read?.ok?read.rows:null,issue=fileError?new MonthlyCsvError(fileError):read&&!read.ok?read.error:null;
 const reviewJson=useMemo(()=>JSON.stringify(rows?monthlyImportReview(rows):[]),[rows]),confirmationKey=JSON.stringify([format,locale,text,reviewJson,snapshot.stateToken]);
 const confirmed=rows!==null&&reviewedKey===confirmationKey;
 const totals=rows?.reduce((s,r)=>({defined:s.defined+r.definedCount,changed:s.changed+r.changedCount,removed:s.removed+r.removedCount}),{defined:0,changed:0,removed:0});
 async function onFile(file:File|undefined){
  const seq=++sequence.current;setText(null);setReviewedKey(null);setFileError(null);setReading(false);
  if(!file)return;if(!file.size||file.size>MAX_BUDGET_CSV_BYTES){setFileError(file.size?"tooLarge":"empty");return;}setReading(true);
  try{const bytes=new Uint8Array(await file.arrayBuffer());if(seq!==sequence.current)return;setText(decodeBudgetCsv(bytes));}
  catch(e){if(seq===sequence.current)setFileError(e instanceof BudgetCsvError?e.code:"encoding");}
  finally{if(seq===sequence.current)setReading(false);}
 }
 const money=(v:bigint|null)=>v===null?t("notSet"):formatMoney(v,locale);
 return <form action={formAction} onReset={e=>e.preventDefault()} onSubmit={e=>{if(!rows||!confirmed||reading)e.preventDefault();}} className="space-y-5">
  <StateError state={state}/><noscript><p>{t("importJavaScript")}</p></noscript>
  <div className="grid gap-4 rounded-lg border border-stone-200 bg-white p-4 sm:grid-cols-2 dark:border-stone-800 dark:bg-stone-900">
   <div><label htmlFor={`${id}-format`} className="mb-1 block text-sm font-medium">{t("importFormat")}</label><select id={`${id}-format`} name="format" value={format} onChange={e=>{setFormat(e.target.value as BudgetCsvFormat);setReviewedKey(null);}} className={CONTROL}><option value="fr-CA">{t("importFormatFr")}</option><option value="en">{t("importFormatEn")}</option></select></div>
   <div className="flex items-end"><a href={`${path}/modele?format=${format}`} className={`inline-flex min-h-11 items-center rounded-md border border-stone-300 px-4 text-sm dark:border-stone-700 ${FOCUS}`}>{t("importTemplate")}</a></div>
   <div className="min-w-0 sm:col-span-2"><label htmlFor={`${id}-file`} className="mb-1 block text-sm font-medium">{t("importFile")}</label><input id={`${id}-file`} name="file" type="file" required accept=".csv,text/csv" onChange={e=>void onFile(e.target.files?.[0])} aria-describedby={`${id}-hint`} className={`${CONTROL} file:mr-3`}/><p id={`${id}-hint`} className="mt-2 text-xs text-stone-600 dark:text-stone-400">{t("monthlyImportFileHint")}</p></div>
  </div>
  <div aria-live="polite">{reading?<p role="status">{t("importReading")}</p>:issue?<p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">{t(`monthlyImportErrors.${issue.code}`,{row:issue.row})}</p>:rows?<p role="status">{t("importReady",{count:rows.length})}</p>:<p className="text-sm text-stone-600 dark:text-stone-400">{t("importPick")}</p>}</div>
  {rows&&totals?<>
   <section aria-labelledby={`${id}-preview`} className="space-y-4"><h2 id={`${id}-preview`} className="text-lg font-semibold">{t("monthlyImportPreview")}</h2><p className="rounded-lg border border-amber-300 p-3 text-sm">{t("monthlyImportCounts",{accounts:rows.length,...totals})}</p>
    <ul className="space-y-3">{rows.map(r=><li key={r.accountId}><details className="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900"><summary className={`min-h-11 cursor-pointer break-words font-medium ${FOCUS}`}>{r.accountCode} · {locale==="en"?r.nameEn:r.nameFr}<span className="mt-2 block text-sm font-normal">{t("monthlyImportAccount",{annual:formatMoney(r.annualCents,locale),allocated:formatMoney(r.allocatedCents,locale),remaining:formatMoney(r.remainingCents,locale),count:r.definedCount})}</span></summary>
     <ol className="mt-3 grid gap-3 sm:grid-cols-2">{r.months.map((v,i)=><li key={i} className="space-y-2 rounded-md border border-stone-200 p-3 text-sm dark:border-stone-700"><h3 className="font-semibold">{t("monthlyCopyPeriod",{number:i+1})}</h3><p className="tabular-nums">{snapshot.periods[i]!.from} → {snapshot.periods[i]!.to}</p><dl className="space-y-1"><div className="flex flex-wrap justify-between gap-2"><dt>{t("monthlyImportBefore")}</dt><dd className="tabular-nums">{money(r.before[i]!)}</dd></div><div className="flex flex-wrap justify-between gap-2"><dt>{t("monthlyImportAfter")}</dt><dd className="font-semibold tabular-nums">{money(v)}</dd></div></dl></li>)}</ol>
    </details></li>)}</ul>
   </section>
   <input type="hidden" name="review" value={reviewJson}/>
   <label className="flex min-h-11 items-start gap-3 text-sm"><input type="checkbox" name="confirmed" value="yes" required checked={confirmed} onChange={e=>setReviewedKey(e.target.checked?confirmationKey:null)} className={`mt-1 h-5 w-5 shrink-0 ${FOCUS}`}/><span>{t("monthlyImportConfirm",{count:rows.length})}</span></label>
   <SubmitButton pendingLabel={t("monthlyImportWorking")}>{t("monthlyImportSubmit")}</SubmitButton>
  </>:null}
  <p className="text-sm text-stone-600 dark:text-stone-400">{t("monthlyImportStaleHint")}</p><a href={path} className={`inline-flex min-h-11 items-center text-sm underline ${FOCUS}`}>{t("copyReload")}</a>
 </form>;
}
