import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from '@/platform/i18n/server';
import { getMonthlyAllocation } from '@/modules/budgets';
import { AppError } from '@/platform/errors';
import { loadCompany,accountName } from '../../../../_lib';
import { MonthlyAllocationForm } from './form';
export const dynamic='force-dynamic';
export async function generateMetadata(){return {title:(await getTranslations('budgets'))('monthlyEdit')};}
export default async function Page({params,searchParams}:{params:Promise<{companyId:string;budgetId:string;accountId:string}>;searchParams:Promise<{periode?:string|string[]}>}){
 const {company,actor,locale}=await loadCompany(params,'budget.manage'),{budgetId,accountId}=await params,t=await getTranslations('budgets');
 const data=await getMonthlyAllocation(actor,budgetId,accountId).catch(e=>{if(e instanceof AppError&&['budgets.notFound','budgets.account'].includes(e.key))notFound();if(e instanceof AppError&&e.key==='budgets.monthlyPeriods')return e;throw e;});
 if(data instanceof AppError)return <section><h1 className="text-2xl font-semibold">{t('monthlyEdit')}</h1><p role="alert" className="mt-4">{(await getTranslations('errors'))('budgets.monthlyPeriods')}</p></section>;
 const q=await searchParams,requested=typeof q.periode==='string'?q.periode:'',period=data.periods.find(p=>p.id===requested)??data.periods[0]!;
 return <section className="max-w-5xl space-y-5"><Link href={`/c/${company.id}/budgets/${budgetId}/mensuel?periode=${period.id}`} className="inline-flex min-h-11 items-center text-sm text-brand-700 underline dark:text-brand-400">{t('monthlyBack')}</Link><div><h1 className="text-2xl font-semibold">{t('monthlyEdit')}</h1><p className="mt-2 break-words font-medium">{data.account.code} · {accountName(data.account,locale)}</p>{!data.account.isActive?<p className="mt-1 text-xs">{t("inactive")}</p>:null}<p className="mt-1 text-sm">{data.budget.name} · {data.budget.from} → {data.budget.to}</p></div><MonthlyAllocationForm companyId={company.id} budgetId={budgetId} accountId={accountId} revision={data.budget.revision} annualCents={data.account.annualCents.toString()} periods={data.periods.map(p=>({...p,targetCents:data.account.months.find(m=>m.periodId===p.id)?.targetCents?.toString()??null}))} returnPeriod={period.id}/><a href={`/c/${company.id}/budgets/${budgetId}/mensuel/${accountId}?periode=${period.id}`} className="inline-flex min-h-11 items-center text-sm text-brand-700 underline dark:text-brand-400">{t('reload')}</a></section>;
}
