"use client";
import { useId,useMemo,useRef,useState } from "react";
import { useLocale,useTranslations } from "@/platform/i18n/client";
import { StateError,SubmitButton,useScopedAction } from "@/app/_components/ui";
import { FOCUS } from "@/app/_components/focus";
import { formatMoney } from "@/modules/ledger/client";
import { BudgetCsvError,budgetImportReview,decodeBudgetCsv,MAX_BUDGET_CSV_BYTES,previewBudgetCsv,type BudgetCsvFormat,type BudgetCsvIssue,type ImportAccount } from "@/modules/budgets/client";
import { importCsvAction } from "../actions";
const CONTROL=`min-h-11 min-w-0 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-base dark:border-stone-700 dark:bg-stone-900 ${FOCUS}`;
export function ImportBudgetForm({companyId,accounts,years,initialFormat}:{companyId:string;accounts:ImportAccount[];years:{id:string;start:string;end:string}[];initialFormat:BudgetCsvFormat}){
  const t=useTranslations("budgets"),locale=useLocale()==="en"?"en":"fr-CA",id=useId(),sequence=useRef(0);
  const [name,setName]=useState(""),[year,setYear]=useState(""),[format,setFormat]=useState(initialFormat),[text,setText]=useState<string|null>(null),[reading,setReading]=useState(false),[fileError,setFileError]=useState<BudgetCsvIssue|null>(null),[reviewedKey,setReviewedKey]=useState<string|null>(null);
  const {state,formAction}=useScopedAction(importCsvAction.bind(null,companyId));
  const read=useMemo(()=>{
    if(text===null)return null;
    try{return {ok:true as const,rows:previewBudgetCsv(text,format,accounts)};}
    catch(e){return {ok:false as const,error:e instanceof BudgetCsvError?e:new BudgetCsvError("syntax")};}
  },[text,format,accounts]);
  const rows=read?.ok?read.rows:null,issue=fileError?new BudgetCsvError(fileError):read&&!read.ok?read.error:null;
  const reviewJson=useMemo(()=>JSON.stringify(rows?budgetImportReview(rows):[]),[rows]);
  const confirmationKey=JSON.stringify([name,year,format,locale])+":"+reviewJson;
  // Forget the old acknowledgement permanently, even when a language change is reversed.
  const [observedKey,setObservedKey]=useState(confirmationKey);
  if(observedKey!==confirmationKey){setObservedKey(confirmationKey);setReviewedKey(null);}
  const confirmed=rows!==null&&reviewedKey===confirmationKey;
  const totals=useMemo(()=>rows?.reduce((s,r)=>({revenue:s.revenue+(r.type==="REVENUE"?r.amountCents:0n),expenses:s.expenses+(r.type==="EXPENSE"?r.amountCents:0n)}),{revenue:0n,expenses:0n}),[rows]);
  async function onFile(file:File|undefined){
    const seq=++sequence.current;setText(null);setReviewedKey(null);setFileError(null);setReading(false);
    if(!file)return;
    if(!file.size||file.size>MAX_BUDGET_CSV_BYTES){setFileError(file.size?"tooLarge":"empty");return;}
    setReading(true);
    try{const bytes=new Uint8Array(await file.arrayBuffer());if(seq!==sequence.current)return;setText(decodeBudgetCsv(bytes));}
    catch(e){if(seq===sequence.current)setFileError(e instanceof BudgetCsvError?e.code:"encoding");}
    finally{if(seq===sequence.current)setReading(false);}
  }
  return <form action={formAction} onReset={e=>e.preventDefault()} onSubmit={e=>{if(!rows||!confirmed||reading)e.preventDefault();}} className="space-y-5">
    <StateError state={state}/>
    <noscript><p>{t("importJavaScript")}</p></noscript>
    <div className="grid gap-4 rounded-lg border border-stone-200 bg-white p-4 sm:grid-cols-2 dark:border-stone-800 dark:bg-stone-900">
      <div><label htmlFor={`${id}-name`} className="mb-1 block text-sm font-medium">{t("copyName")}</label><input id={`${id}-name`} name="name" required maxLength={120} autoComplete="off" value={name} onChange={e=>{setName(e.target.value);setReviewedKey(null);}} className={CONTROL}/></div>
      <div><label htmlFor={`${id}-year`} className="mb-1 block text-sm font-medium">{t("copyYear")}</label><select id={`${id}-year`} name="fiscalYearId" required value={year} onChange={e=>{setYear(e.target.value);setReviewedKey(null);}} className={CONTROL}><option value="">{t("importChooseYear")}</option>{years.map(y=><option key={y.id} value={y.id}>{y.start} → {y.end}</option>)}</select></div>
      <div><label htmlFor={`${id}-format`} className="mb-1 block text-sm font-medium">{t("importFormat")}</label><select id={`${id}-format`} name="format" value={format} onChange={e=>{setFormat(e.target.value as BudgetCsvFormat);setReviewedKey(null);}} className={CONTROL}><option value="fr-CA">{t("importFormatFr")}</option><option value="en">{t("importFormatEn")}</option></select></div>
      <div className="flex items-end"><a href={`/c/${companyId}/budgets/importer/modele?format=${format}`} className={`inline-flex min-h-11 items-center rounded-md border border-stone-300 px-4 text-sm dark:border-stone-700 ${FOCUS}`}>{t("importTemplate")}</a></div>
      <div className="min-w-0 sm:col-span-2"><label htmlFor={`${id}-file`} className="mb-1 block text-sm font-medium">{t("importFile")}</label><input id={`${id}-file`} name="file" type="file" required accept=".csv,text/csv" onChange={e=>void onFile(e.target.files?.[0])} aria-describedby={`${id}-hint`} className={`${CONTROL} file:mr-3`}/><p id={`${id}-hint`} className="mt-2 text-xs text-stone-600 dark:text-stone-400">{t("importFileHint")}</p></div>
    </div>
    <div aria-live="polite">{reading?<p role="status">{t("importReading")}</p>:issue?<p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">{t(`importErrors.${issue.code}`,{row:issue.row})}</p>:rows?<p role="status">{t("importReady",{count:rows.length})}</p>:<p className="text-sm text-stone-600 dark:text-stone-400">{t("importPick")}</p>}</div>
    {rows&&totals?<>
      <section aria-labelledby={`${id}-preview`} className="space-y-4"><h2 id={`${id}-preview`} className="text-lg font-semibold">{t("importPreview")}</h2><div className="grid gap-3 sm:grid-cols-2">{(["revenue","expenses"] as const).map(k=><div key={k} className="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900"><p className="text-sm">{t(k)}</p><p className="mt-2 text-xl font-semibold tabular-nums">{formatMoney(totals[k],locale)}</p></div>)}</div>
      <ul className="divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white px-4 dark:divide-stone-800 dark:border-stone-800 dark:bg-stone-900">{rows.map(r=><li key={r.accountCode} className="flex flex-wrap items-start justify-between gap-2 py-3 text-sm"><div className="min-w-0 max-w-full"><p className="break-words font-medium">{r.accountCode} · {locale==="en"?r.nameEn:r.nameFr}</p><p className="mt-1 text-xs text-stone-600 dark:text-stone-400">{t("importRow",{row:r.row})} · {t(r.type==="REVENUE"?"revenue":"expenses")}</p></div><p className="font-semibold tabular-nums">{formatMoney(r.amountCents,locale)}</p></li>)}</ul></section>
      <input type="hidden" name="review" value={reviewJson}/>
      <label className="flex min-h-11 items-start gap-3 text-sm"><input type="checkbox" name="confirmed" value="yes" required checked={confirmed} onChange={e=>setReviewedKey(e.target.checked?confirmationKey:null)} className={`mt-1 h-5 w-5 shrink-0 ${FOCUS}`}/><span>{t("importConfirm",{count:rows.length})}</span></label>
      <SubmitButton>{t("importSubmit")}</SubmitButton>
    </>:null}
    <p className="text-sm text-stone-600 dark:text-stone-400">{t("importStaleHint")}</p><a href={`/c/${companyId}/budgets/importer`} className={`inline-flex min-h-11 items-center text-sm text-brand-700 underline dark:text-brand-400 ${FOCUS}`}>{t("copyReload")}</a>
  </form>;
}
