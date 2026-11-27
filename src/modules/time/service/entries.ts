import "server-only";
import { requireRole } from "@/modules/companies";
import { todayIso } from "@/modules/ledger";
import { AppError } from "@/platform/errors";
import { withCompany, type CompanyContext, type Tx } from "@/platform/tenant";
import { entryInput, timeFilters, timeQuery, TIME_PAGE_SIZE, TIME_EXPORT_LIMIT, type TimeInput, type TimeEntry, type TimeFilters, type TimeReport } from "../domain/entries";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const select={id:true,workDate:true,project:true,person:true,task:true,notes:true,usage:true,minutes:true,revision:true} as const;
function valid(input:TimeInput) {
  const parsed=entryInput.safeParse(input);if(!parsed.success)throw new AppError("time.invalid");
  if(parsed.data.date>todayIso())throw new AppError("time.future");return parsed.data;
}
function dto(row:{id:string;workDate:Date;project:string;person:string;task:string;notes:string;usage:string;minutes:number;revision:number}):TimeEntry {
  if(row.usage!=="BILLABLE"&&row.usage!=="NON_BILLABLE")throw new AppError("time.invalid");
  const {workDate,...rest}=row;return {...rest,date:workDate.toISOString().slice(0,10),usage:row.usage};
}
export async function getTimeEntry(actor:CompanyContext,id:string) {
  if(!UUID.test(id))throw new AppError("time.notFound");
  return withCompany(actor,async tx=>{await requireRole(tx,"time.read");const row=await tx.timeEntry.findFirst({where:{companyId:actor.companyId,id},select});if(!row)throw new AppError("time.notFound");return dto(row);});
}
export async function createTimeEntry(actor:CompanyContext,input:TimeInput) {
  const data=valid(input),{date,...fields}=data;
  return withCompany(actor,async tx=>{await requireRole(tx,"time.manage");return (await tx.timeEntry.create({data:{companyId:actor.companyId,...fields,workDate:new Date(date+"T00:00:00Z")},select:{id:true}})).id;});
}
async function lock(tx:Tx,actor:CompanyContext,id:string,revision:number) {
  if(!UUID.test(id)||!Number.isSafeInteger(revision)||revision<1||revision>=2147483647)throw new AppError("time.invalid");
  const [r]=await tx.$queryRaw<{revision:number;date:string}[]>`SELECT revision,to_char(work_date,'YYYY-MM-DD') AS date FROM time_entry WHERE company_id=${actor.companyId}::uuid AND id=${id}::uuid FOR UPDATE`;
  if(!r)throw new AppError("time.notFound");if(r.revision!==revision)throw new AppError("time.stale");return r;
}
export async function updateTimeEntry(actor:CompanyContext,id:string,revision:number,input:TimeInput) {
  const {date,...fields}=valid(input);
  return withCompany(actor,async tx=>{await requireRole(tx,"time.manage");await lock(tx,actor,id,revision);if((await tx.timeEntry.updateMany({where:{companyId:actor.companyId,id},data:{...fields,workDate:new Date(date+"T00:00:00Z"),revision:revision+1}})).count!==1)throw new AppError("forbidden");});
}
export async function deleteTimeEntry(actor:CompanyContext,id:string,revision:number,confirmed:boolean) {
  if(confirmed!==true)throw new AppError("time.confirm");
  return withCompany(actor,async tx=>{await requireRole(tx,"time.manage");const r=await lock(tx,actor,id,revision);if((await tx.timeEntry.deleteMany({where:{companyId:actor.companyId,id}})).count!==1)throw new AppError("forbidden");return r.date;});
}
export async function getTimeLog(actor:CompanyContext,input:TimeFilters,options:{allRows?:boolean}={}):Promise<TimeReport> {
  const complete=!!options.allRows,limit=TIME_EXPORT_LIMIT;
  let filters:TimeFilters;try{filters=timeFilters(Object.fromEntries(new URLSearchParams(timeQuery(input,input.page))),todayIso());}catch{throw new AppError("time.filters");}
  return withCompany(actor,async tx=>{
    await requireRole(tx,"time.read");
    const [r]=await tx.$queryRaw<{rows:TimeEntry[];count:string;page:string;pages:string;billable:string;nonbillable:string}[]>`
      WITH filtered AS (SELECT * FROM time_entry WHERE company_id=${actor.companyId}::uuid AND work_date BETWEEN ${filters.from}::date AND ${filters.to}::date AND (${filters.usage}='ALL' OR usage=${filters.usage}) AND position(lower(${filters.project}) in lower(project))>0),
      summary AS(SELECT count(*) AS n,coalesce(sum(minutes) FILTER(WHERE usage='BILLABLE'),0) AS billable,coalesce(sum(minutes) FILTER(WHERE usage='NON_BILLABLE'),0) AS nonbillable FROM filtered),
      paging AS(SELECT *,least(${filters.page}::bigint,greatest(1,(n+${TIME_PAGE_SIZE-1})/${TIME_PAGE_SIZE})) AS page,greatest(1,(n+${TIME_PAGE_SIZE-1})/${TIME_PAGE_SIZE}) AS pages FROM summary)
      SELECT n::text AS count,page::text,pages::text,billable::text,nonbillable::text,
       coalesce((SELECT jsonb_agg(detail ORDER BY detail.date DESC,detail.created DESC,detail.id DESC) FROM(SELECT id,to_char(work_date,'YYYY-MM-DD') AS date,created_at AS created,project,person,task,notes,usage,minutes AS "minutes",revision FROM filtered ORDER BY work_date DESC,created_at DESC,id DESC LIMIT ${complete?limit+1:TIME_PAGE_SIZE} OFFSET (CASE WHEN ${complete} THEN 0 ELSE (page-1)*${TIME_PAGE_SIZE} END))detail),'[]'::jsonb) AS rows FROM paging`;
    if(!r||![r.count,r.page,r.pages].every(v=>Number.isSafeInteger(Number(v))))throw new AppError("time.limit");
    if(complete&&Number(r.count)>limit)throw new AppError("time.exportLimit");
    return {filters,rows:r.rows.map(row=>({id:row.id,date:row.date,project:row.project,person:row.person,task:row.task,notes:row.notes,usage:row.usage,minutes:row.minutes,revision:row.revision})),count:Number(r.count),page:Number(r.page),pageCount:Number(r.pages),billableMinutes:BigInt(r.billable),nonBillableMinutes:BigInt(r.nonbillable)};
  });
}
