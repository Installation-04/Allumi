import { getTranslations } from '@/platform/i18n/server';
import { financeFilters,getProjectFinance,financeCsv } from '@/modules/projects';
import { todayIso } from '@/modules/ledger';
import { AppError } from '@/platform/errors';
import { loadCompany } from '../../../../_lib';
export const dynamic='force-dynamic';
export async function GET(request:Request,{params}:{params:Promise<{companyId:string;projectId:string}>}){
 const {actor,locale}=await loadCompany(params,'project.read'),{projectId}=await params,headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
 try{const q=new URL(request.url).searchParams,input=Object.fromEntries([...new Set(q.keys())].map(k=>[k,q.getAll(k).length>1?q.getAll(k):q.get(k)??'']));let f;try{f=financeFilters(input,todayIso());}catch{throw new AppError('projectFinance.filters');}const r=await getProjectFinance(actor,projectId,f,'export'),t=await getTranslations('projectFinance');return new Response('\uFEFF'+financeCsv(r,locale,t),{headers:{...headers,'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="project_${r.code}_${f.from}_${f.to}.csv"`}});}catch(e){if(e instanceof AppError&&e.key==='project.notFound')return new Response(null,{status:404,headers});if(e instanceof AppError&&['projectFinance.filters','projectFinance.exportLimit','projectFinance.limit'].includes(e.key))return new Response((await getTranslations('errors'))(e.key as 'projectFinance.filters'),{status:e.key==='projectFinance.filters'?400:422,headers:{...headers,'Content-Type':'text/plain; charset=utf-8'}});throw e;}
}
