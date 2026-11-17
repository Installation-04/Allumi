import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getMonthlyBudget,monthlyBudgetCsv } from '@/modules/budgets';
import { AppError } from '@/platform/errors';
import { loadCompany } from '../../../../_lib';
export const dynamic='force-dynamic';
export async function GET(request:Request,{params}:{params:Promise<{companyId:string;budgetId:string}>}){
 const {actor,locale}=await loadCompany(params,'ledger.read'),{budgetId}=await params,q=new URL(request.url).searchParams.getAll('periode');if(q.length>1)notFound();
 const r=await getMonthlyBudget(actor,budgetId,q[0]).catch(e=>{if(e instanceof AppError&&['budgets.notFound','budgets.monthlyPeriod'].includes(e.key))notFound();if(e instanceof AppError&&['budgets.tooMany','budgets.monthlyPeriods'].includes(e.key))return e;throw e;});
 const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
 if(r instanceof AppError)return new Response((await getTranslations('errors'))(r.key as 'budgets.tooMany'),{status:422,headers:{...headers,'Content-Type':'text/plain; charset=utf-8'}});
 const t=await getTranslations('budgets');return new Response(`\uFEFF${monthlyBudgetCsv(r,locale,t)}`,{headers:{...headers,'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="monthly_budget_${r.selected.from}_${r.selected.to}.csv"`}});
}
