import { getTranslations } from "@/platform/i18n/server";
import { getTimeLog, timeFilters, timeCsv } from "@/modules/time";
import { todayIso } from "@/modules/ledger";
import { AppError } from "@/platform/errors";
import { loadCompany } from "../../_lib";
export const dynamic="force-dynamic";
export async function GET(request:Request,{params}:{params:Promise<{companyId:string}>}) {
  const {actor,locale}=await loadCompany(params,"time.read"),headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
  try {
    const query=new URL(request.url).searchParams,q=Object.fromEntries([...new Set(query.keys())].map(k=>[k,query.getAll(k).length>1?query.getAll(k):query.get(k)??'']));
    let filters;try{filters=timeFilters(q,todayIso());}catch{throw new AppError("time.filters");}
    const report=await getTimeLog(actor,filters,{allRows:true}),t=await getTranslations("time");
    return new Response('\uFEFF'+timeCsv(report,locale,t),{headers:{...headers,'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="time_${filters.from}_${filters.to}.csv"`}});
  }catch(e){if(e instanceof AppError&&['time.filters','time.exportLimit','time.limit'].includes(e.key))return new Response((await getTranslations('errors'))(e.key as 'time.filters'),{status:e.key==='time.filters'?400:422,headers:{...headers,'Content-Type':'text/plain; charset=utf-8'}});throw e;}
}
