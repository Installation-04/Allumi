import { getTranslations } from "@/platform/i18n/server";
import { exportClientDocuments,clientDocumentsCsv } from "@/modules/contracts";
import { AppError } from "@/platform/errors";
import { loadCompany } from "../../_lib";
export const dynamic='force-dynamic';
export async function GET(request:Request,{params}:{params:Promise<{companyId:string}>}){
 const {actor,locale}=await loadCompany(params,'sales.read'),headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'};
 try{const q=new URL(request.url).searchParams,query=Object.fromEntries([...new Set(q.keys())].map(k=>[k,q.getAll(k).length>1?q.getAll(k):q.get(k)??''])),rows=await exportClientDocuments(actor,query),t=await getTranslations('contracts');return new Response('\uFEFF'+clientDocumentsCsv(rows,locale,t),{headers:{...headers,'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="contract_tracking.csv"'}});}
 catch(e){if(e instanceof AppError&&['contracts.invalid','contracts.exportLimit'].includes(e.key))return new Response((await getTranslations('errors'))(e.key as 'contracts.invalid'),{status:e.key==='contracts.invalid'?400:422,headers:{...headers,'Content-Type':'text/plain; charset=utf-8'}});throw e;}
}
