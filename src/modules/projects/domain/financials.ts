import { isValidIsoDate,type Locale } from '@/modules/ledger/client';
import { toCsv,csvFormatFor,type CsvCell } from '@/modules/reports/client';
export const FINANCE_PAGE_SIZE=50,FINANCE_EXPORT_LIMIT=5000,FINANCE_PRINT_LIMIT=1000;
export type FinanceFilters={from:string;to:string;page:number};
export function financeFilters(q:Record<string,string|string[]|undefined>,today:string):FinanceFilters{
 const one=(k:string,d:string)=>{const v=q[k];if(v===undefined)return d;if(typeof v!=='string')throw new RangeError('finance filters');return v;};
 const from=one('du',today.slice(0,4)+'-01-01'),to=one('au',today),page=one('page','1');
 if(!isValidIsoDate(from)||!isValidIsoDate(to)||from>to||to>today||(Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z'))/86400000>365||!/^[1-9]\d*$/.test(page)||!Number.isSafeInteger(Number(page)))throw new RangeError('finance filters');
 return {from,to,page:Number(page)};
}
export function financeQuery(f:FinanceFilters,page?:number){const q=new URLSearchParams({du:f.from,au:f.to});if(page!==undefined)q.set('page',String(page));return q.toString();}
export function entryNumber(value:unknown):bigint{if(typeof value!=='string'||! /^\d{1,19}$/.test(value)||BigInt(value)<1n||BigInt(value)>9223372036854775807n)throw new RangeError('entry number');return BigInt(value);}
export type FinanceRow={id:string;number:string;date:string;rootNumber:string;reversed:boolean;revenue:bigint;expenses:bigint};
export type ProjectFinance={code:string;name:string;status:string;filters:FinanceFilters;rows:FinanceRow[];count:number;page:number;pages:number;revenue:bigint;expenses:bigint};
type Label='title'|'scope'|'project'|'from'|'to'|'date'|'number'|'original'|'reversal'|'yes'|'no'|'revenue'|'expenses'|'contribution'|'count';
export function financeCsv(r:ProjectFinance,locale:Locale,t:(k:Label)=>string){if(r.rows.length!==r.count||r.count>FINANCE_EXPORT_LIMIT)throw new RangeError('incomplete project finance export');const rows:CsvCell[][]=[[t('title')],[t('scope')],[t('project'),r.code,r.name],[t('from'),r.filters.from],[t('to'),r.filters.to],[t('date'),t('number'),t('original'),t('reversal'),t('revenue'),t('expenses'),t('contribution')],...r.rows.map(x=>[x.date,x.number,x.rootNumber,t(x.reversed?'yes':'no'),x.revenue,x.expenses,x.revenue-x.expenses]),[t('count'),String(r.count)],[t('revenue'),r.revenue],[t('expenses'),r.expenses],[t('contribution'),r.revenue-r.expenses]];return toCsv(rows,csvFormatFor(locale));}
