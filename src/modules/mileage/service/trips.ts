import "server-only";
import { requireRole } from "@/modules/companies";
import { todayIso } from "@/modules/ledger";
import { AppError } from "@/platform/errors";
import { withCompany, type CompanyContext, type Tx } from "@/platform/tenant";
import { tripInput, mileageFilters, mileageQuery, MILEAGE_PAGE_SIZE, MILEAGE_EXPORT_LIMIT, type TripInput, type MileageTrip, type MileageFilters, type MileageReport } from "../domain/trips";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const select={id:true,tripDate:true,vehicle:true,origin:true,destination:true,purpose:true,usage:true,distanceMeters:true,revision:true} as const;
function valid(input:TripInput) {
  const parsed=tripInput.safeParse(input);if(!parsed.success)throw new AppError("mileage.invalid");
  if(parsed.data.date>todayIso())throw new AppError("mileage.future");return parsed.data;
}
function dto(row:{id:string;tripDate:Date;vehicle:string;origin:string;destination:string;purpose:string;usage:string;distanceMeters:number;revision:number}):MileageTrip {
  if(row.usage!=="BUSINESS"&&row.usage!=="PERSONAL")throw new AppError("mileage.invalid");
  const {tripDate,...rest}=row;return {...rest,date:tripDate.toISOString().slice(0,10),usage:row.usage};
}
export async function getMileageTrip(actor:CompanyContext,id:string) {
  if(!UUID.test(id))throw new AppError("mileage.notFound");
  return withCompany(actor,async tx=>{await requireRole(tx,"mileage.read");const row=await tx.mileageTrip.findFirst({where:{companyId:actor.companyId,id},select});if(!row)throw new AppError("mileage.notFound");return dto(row);});
}
export async function createMileageTrip(actor:CompanyContext,input:TripInput) {
  const data=valid(input),{date,...fields}=data;
  return withCompany(actor,async tx=>{await requireRole(tx,"mileage.manage");return (await tx.mileageTrip.create({data:{companyId:actor.companyId,...fields,tripDate:new Date(date+"T00:00:00Z")},select:{id:true}})).id;});
}
async function lock(tx:Tx,actor:CompanyContext,id:string,revision:number) {
  if(!UUID.test(id)||!Number.isSafeInteger(revision)||revision<1||revision>=2147483647)throw new AppError("mileage.invalid");
  const [r]=await tx.$queryRaw<{revision:number;date:string}[]>`SELECT revision,to_char(trip_date,'YYYY-MM-DD') AS date FROM mileage_trip WHERE company_id=${actor.companyId}::uuid AND id=${id}::uuid FOR UPDATE`;
  if(!r)throw new AppError("mileage.notFound");if(r.revision!==revision)throw new AppError("mileage.stale");return r;
}
export async function updateMileageTrip(actor:CompanyContext,id:string,revision:number,input:TripInput) {
  const {date,...fields}=valid(input);
  return withCompany(actor,async tx=>{await requireRole(tx,"mileage.manage");await lock(tx,actor,id,revision);if((await tx.mileageTrip.updateMany({where:{companyId:actor.companyId,id},data:{...fields,tripDate:new Date(date+"T00:00:00Z"),revision:revision+1}})).count!==1)throw new AppError("forbidden");});
}
export async function deleteMileageTrip(actor:CompanyContext,id:string,revision:number,confirmed:boolean) {
  if(confirmed!==true)throw new AppError("mileage.confirm");
  return withCompany(actor,async tx=>{await requireRole(tx,"mileage.manage");const r=await lock(tx,actor,id,revision);if((await tx.mileageTrip.deleteMany({where:{companyId:actor.companyId,id}})).count!==1)throw new AppError("forbidden");return r.date;});
}
export async function getMileageLog(actor:CompanyContext,input:MileageFilters,options:{allRows?:boolean}={}):Promise<MileageReport> {
  let filters:MileageFilters;try{filters=mileageFilters(Object.fromEntries(new URLSearchParams(mileageQuery(input,input.page))),todayIso());}catch{throw new AppError("mileage.filters");}
  return withCompany(actor,async tx=>{
    await requireRole(tx,"mileage.read");
    const [r]=await tx.$queryRaw<{rows:MileageTrip[];count:string;page:string;pages:string;business:string;personal:string}[]>`
      WITH filtered AS (SELECT * FROM mileage_trip WHERE company_id=${actor.companyId}::uuid AND trip_date BETWEEN ${filters.from}::date AND ${filters.to}::date AND (${filters.usage}='ALL' OR usage=${filters.usage}) AND position(lower(${filters.vehicle}) in lower(vehicle))>0),
      summary AS(SELECT count(*) AS n,coalesce(sum(distance_meters) FILTER(WHERE usage='BUSINESS'),0) AS business,coalesce(sum(distance_meters) FILTER(WHERE usage='PERSONAL'),0) AS personal FROM filtered),
      paging AS(SELECT *,least(${filters.page}::bigint,greatest(1,(n+${MILEAGE_PAGE_SIZE-1})/${MILEAGE_PAGE_SIZE})) AS page,greatest(1,(n+${MILEAGE_PAGE_SIZE-1})/${MILEAGE_PAGE_SIZE}) AS pages FROM summary)
      SELECT n::text AS count,page::text,pages::text,business::text,personal::text,
       coalesce((SELECT jsonb_agg(detail ORDER BY detail.date DESC,detail.created DESC,detail.id DESC) FROM(SELECT id,to_char(trip_date,'YYYY-MM-DD') AS date,created_at AS created,vehicle,origin,destination,purpose,usage,distance_meters AS "distanceMeters",revision FROM filtered ORDER BY trip_date DESC,created_at DESC,id DESC LIMIT ${options.allRows?MILEAGE_EXPORT_LIMIT+1:MILEAGE_PAGE_SIZE} OFFSET (CASE WHEN ${!!options.allRows} THEN 0 ELSE (page-1)*${MILEAGE_PAGE_SIZE} END))detail),'[]'::jsonb) AS rows FROM paging`;
    if(!r||![r.count,r.page,r.pages].every(v=>Number.isSafeInteger(Number(v))))throw new AppError("mileage.limit");
    if(options.allRows&&Number(r.count)>MILEAGE_EXPORT_LIMIT)throw new AppError("mileage.exportLimit");
    return {filters,rows:r.rows.map(row=>({id:row.id,date:row.date,vehicle:row.vehicle,origin:row.origin,destination:row.destination,purpose:row.purpose,usage:row.usage,distanceMeters:row.distanceMeters,revision:row.revision})),count:Number(r.count),page:Number(r.page),pageCount:Number(r.pages),businessMeters:BigInt(r.business),personalMeters:BigInt(r.personal)};
  });
}
