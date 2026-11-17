"use client";
import { useId,useState } from "react";
import { useLocale,useTranslations } from "@/platform/i18n/client";
import { ActionForm } from "@/app/_components/ui";
import { FOCUS } from "@/app/_components/focus";
import { formatMoney,parseMoney } from "@/modules/ledger/client";
import { allocationSummary,splitAnnualTarget } from "@/modules/budgets/client";
import { saveMonthsAction } from "../../../actions";
function input(cents:bigint|null,locale:string){return cents===null?'':`${cents/100n}${locale==='en'?'.':','}${(cents%100n).toString().padStart(2,'0')}`;}
export function MonthlyAllocationForm(props:{companyId:string;budgetId:string;accountId:string;revision:number;annualCents:string;periods:{id:string;number:number;from:string;to:string;targetCents:string|null}[];returnPeriod:string}){
 const locale=useLocale()==='en'?'en':'fr-CA',t=useTranslations('budgets'),id=useId();
 // Never silently rebind an edited form to a newer server revision during a language/theme refresh.
 const [snapshot]=useState(()=>({revision:props.revision,annualCents:BigInt(props.annualCents),periods:props.periods}));
 const [values,setValues]=useState(()=>snapshot.periods.map(p=>input(p.targetCents===null?null:BigInt(p.targetCents),locale))),[seenLocale,setSeenLocale]=useState<"en"|"fr-CA">(locale);
 if(locale!==seenLocale){setSeenLocale(locale);setValues(v=>v.map(s=>{const n=parseMoney(s,seenLocale);return n===null||n<0n?s:input(n,locale);}));}
 const parsed=values.map(s=>s.trim()?parseMoney(s,locale):null),valid=values.every((s,i)=>!s.trim()||(parsed[i]!==null&&parsed[i]!>=0n));
 const summary=valid?allocationSummary(snapshot.annualCents,parsed):null;
 return <ActionForm action={saveMonthsAction.bind(null,props.companyId,props.budgetId,props.accountId,snapshot.revision,snapshot.periods.map(p=>p.id),props.returnPeriod)} label={t('monthlySave')} variant="primary" preserveOnReset>
  <div className="grid gap-3 rounded-lg border border-stone-200 bg-white p-4 sm:grid-cols-3 dark:border-stone-800 dark:bg-stone-900">{(['annual','allocated','remaining'] as const).map(k=><div key={k}><p className="text-sm">{t(k==='annual'?'target':k==='allocated'?'monthlyAllocated':'monthlyRemaining')}</p><p className="mt-1 font-semibold tabular-nums">{k==='annual'?formatMoney(snapshot.annualCents,locale):summary?formatMoney(k==='allocated'?summary.allocatedCents:summary.remainingCents,locale):'—'}</p></div>)}</div>
  {!valid?<p role="alert" className="text-sm text-red-700 dark:text-red-300">{t('monthlyInvalidHint')}</p>:summary&&summary.remainingCents<0n?<p role="alert" className="text-sm text-red-700 dark:text-red-300">{t('monthlyExcessHint')}</p>:null}
  <button type="button" onClick={()=>setValues(splitAnnualTarget(snapshot.annualCents).map(n=>input(n,locale)))} className={`min-h-11 rounded-md border border-stone-300 px-4 text-sm dark:border-stone-700 ${FOCUS}`}>{t('monthlySplit')}</button>
  <button type="button" onClick={()=>setValues(Array(12).fill(''))} className={`min-h-11 rounded-md border border-stone-300 px-4 text-sm dark:border-stone-700 ${FOCUS}`}>{t('monthlyClear')}</button>
  <p className="text-sm text-stone-600 dark:text-stone-400">{t('monthlyEditHint')}</p>
  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{snapshot.periods.map((p,i)=><div key={p.id}><label htmlFor={`${id}-${p.id}`} className="mb-1 block text-sm font-medium">{t('monthlyRange',{number:p.number,from:p.from,to:p.to})}</label><input id={`${id}-${p.id}`} name={`period_${p.id}`} value={values[i]??''} inputMode="decimal" autoComplete="off" onChange={e=>setValues(v=>v.map((s,j)=>j===i?e.target.value:s))} className={`min-h-11 min-w-0 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-base dark:border-stone-700 dark:bg-stone-900 ${FOCUS}`}/></div>)}</div>
 </ActionForm>;
}
