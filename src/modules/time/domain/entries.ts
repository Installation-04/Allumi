import { z } from "zod";
import { PROJECT_CODE } from "@/modules/projects/client";
import { isValidIsoDate, type Locale } from "@/modules/ledger/client";
import { toCsv, csvFormatFor, type CsvCell } from "@/modules/reports/client";
export const TIME_PAGE_SIZE=50,TIME_EXPORT_LIMIT=5000,TIME_PRINT_LIMIT=1000,MAX_ENTRY_MINUTES=1440;
export const TIME_USES=["BILLABLE","NON_BILLABLE"] as const;
const line=(min:number,max:number)=>z.string().refine(s=>!/[\p{Cc}\p{Zl}\p{Zp}]/u.test(s)).transform(s=>s.trim()).refine(s=>[...s].length>=min&&[...s].length<=max);
export const entryInput=z.object({date:z.string().refine(isValidIsoDate),project:line(0,120),projectId:z.uuid().nullable().optional(),person:line(1,80),task:line(1,200),notes:line(0,200),usage:z.enum(TIME_USES),minutes:z.number().int().min(1).max(MAX_ENTRY_MINUTES)}).refine(v=>!!v.projectId||v.project.length>0);
export type TimeInput=z.infer<typeof entryInput>;
export type TimeEntry=TimeInput&{id:string;revision:number;projectCode?:string|null};
export type TimeFilters={from:string;to:string;project:string;usage:"ALL"|typeof TIME_USES[number];page:number;projectCode?:string};
/** h:mm and integer minutes are exact. Decimal hours are refused. */
export function parseDuration(value:string):number|null{
 const s=value.trim();let minutes:bigint;
 if(/^\d{1,2}:[0-5]\d$/.test(s)){const [h,m]=s.split(':');minutes=BigInt(h!)*60n+BigInt(m!);}else if(/^\d{1,4}$/.test(s))minutes=BigInt(s);else return null;
 return minutes>=1n&&minutes<=BigInt(MAX_ENTRY_MINUTES)?Number(minutes):null;
}
export function duration(value:bigint|number,locale:Locale,grouped=true):string{
 if(typeof value==='number'&&!Number.isSafeInteger(value))throw new RangeError('invalid duration');const minutes=BigInt(value);if(minutes<0n)throw new RangeError('invalid duration');
 const h=(minutes/60n).toString();return `${grouped?h.replace(/\B(?=(\d{3})+(?!\d))/g,locale==='en'?',':'\u00a0'):h}:${(minutes%60n).toString().padStart(2,'0')}`;
}
export function timeFilters(q:Record<string,string|string[]|undefined>,today:string):TimeFilters{
 const one=(k:string,fallback:string)=>{const v=q[k];if(v===undefined)return fallback;if(typeof v!=='string')throw new RangeError('time filters');return v;};
 const projectCode=one('dossier','').trim().toUpperCase();
 const from=one('du',today.slice(0,4)+'-01-01'),to=one('au',today),text=one('projet',''),project=text.trim(),usage=one('usage','ALL'),page=one('page','1');
 if((projectCode&&!PROJECT_CODE.test(projectCode))||!isValidIsoDate(from)||!isValidIsoDate(to)||from>to||to>today||(Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z'))/86400000>365||[...project].length>120||/[\p{Cc}\p{Zl}\p{Zp}]/u.test(text)||!['ALL',...TIME_USES].includes(usage)||!/^[1-9]\d*$/.test(page)||!Number.isSafeInteger(Number(page)))throw new RangeError('time filters');
 return {from,to,project,usage:usage as TimeFilters['usage'],page:Number(page),...(projectCode?{projectCode}:{})};
}
export function timeQuery(f:TimeFilters,page?:number){const q=new URLSearchParams({du:f.from,au:f.to});if(f.project)q.set('projet',f.project);if(f.projectCode)q.set('dossier',f.projectCode);if(f.usage!=='ALL')q.set('usage',f.usage);if(page!==undefined)q.set('page',String(page));return q.toString();}
export function entryYearFilters(date:string,today:string):TimeFilters{return {from:date.slice(0,4)+'-01-01',to:date.slice(0,4)===today.slice(0,4)?today:date.slice(0,4)+'-12-31',project:'',usage:'ALL',page:1};}
export function projectLabel(entry:Pick<TimeEntry,"project"|"projectCode">){return entry.projectCode?`${entry.projectCode} — ${entry.project}`:entry.project;}
export type TimeReport={filters:TimeFilters;rows:TimeEntry[];count:number;page:number;pageCount:number;billableMinutes:bigint;nonBillableMinutes:bigint};
type Labels='title'|'shared'|'from'|'to'|'project'|'usage'|'ALL'|'BILLABLE'|'NON_BILLABLE'|'date'|'person'|'task'|'notes'|'minutes'|'totalMinutes'|'count';
export function timeCsv(r:TimeReport,locale:Locale,t:(key:Labels)=>string){
 if(r.rows.length!==r.count||r.count>TIME_EXPORT_LIMIT)throw new RangeError('incomplete time export');
 const rows:CsvCell[][]=[[t('title')],[t('shared')],[t('from'),r.filters.from],[t('to'),r.filters.to],[t('project'),[r.filters.project,r.filters.projectCode].filter(Boolean).join(' · ')],[t('usage'),t(r.filters.usage)],[t('date'),t('project'),t('person'),t('task'),t('notes'),t('usage'),t('minutes')],...r.rows.map(a=>[a.date,projectLabel(a),a.person,a.task,a.notes,t(a.usage),String(a.minutes)]),[t('count'),String(r.count)],[t('BILLABLE'),String(r.billableMinutes)],[t('NON_BILLABLE'),String(r.nonBillableMinutes)],[t('totalMinutes'),String(r.billableMinutes+r.nonBillableMinutes)]];
 return toCsv(rows,csvFormatFor(locale));
}
