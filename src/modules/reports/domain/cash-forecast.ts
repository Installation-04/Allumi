import { isValidIsoDate,type Locale } from "@/modules/ledger/client";
import { csvFormatFor,toCsv,type CsvCell } from "./csv";
export const FORECAST_HORIZONS=[7,30,60,90] as const;
export const FORECAST_ITEM_LIMIT=5000;
export const FORECAST_ACCOUNT_LIMIT=1000;
export const FORECAST_PAGE_SIZE=100;
export type ForecastLedger="RECEIVABLE"|"PAYABLE";
export type ForecastOpenItem={id:string;ledger:ForecastLedger;kind:"INVOICE"|"CREDIT_NOTE"|"PAYMENT"|"REFUND";number:string|null;party:string;date:string;dueDate:string|null;cents:bigint};
export type ForecastCashAccount={id:string;code:string;nameFr:string;nameEn:string;isActive:boolean;cents:bigint};
export function cashForecastRange(asOf:string,days:number){
 if(!isValidIsoDate(asOf)||!FORECAST_HORIZONS.some(n=>n===days))throw new RangeError("forecast period");
 const shift=(n:number)=>new Date(Date.parse(asOf+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
 const from=shift(1),to=shift(days);if(!isValidIsoDate(from)||!isValidIsoDate(to)||to<=asOf)throw new RangeError("forecast period");
 return {asOf,days,from,to,dates:Array.from({length:days},(_,i)=>shift(i+1))};
}
export function buildCashForecast(input:{asOf:string;days:number;accounts:readonly ForecastCashAccount[];items:readonly ForecastOpenItem[];receivableControlCents:bigint;payableControlCents:bigint;futureCashCount:number;futureCashCents:bigint}){
 const period=cashForecastRange(input.asOf,input.days);
 if(input.accounts.length>FORECAST_ACCOUNT_LIMIT||input.items.length>FORECAST_ITEM_LIMIT)throw new RangeError("forecast size");
 if(input.items.some(i=>i.cents<=0n||!isValidIsoDate(i.date)||(i.dueDate!==null&&!isValidIsoDate(i.dueDate))))throw new RangeError("forecast source");
 const openingCents=input.accounts.reduce((n,a)=>n+a.cents,0n);
 const items=input.items.filter(i=>i.kind==="INVOICE"&&(i.dueDate??i.date)<=period.to).map(i=>({...i,projectedDate:(i.dueDate??i.date)<period.from?period.from:(i.dueDate??i.date),carried:(i.dueDate??i.date)<period.from})).sort((a,b)=>a.projectedDate.localeCompare(b.projectedDate)||a.ledger.localeCompare(b.ledger)||(a.number??'').localeCompare(b.number??'')||a.id.localeCompare(b.id));
 let balance=openingCents,minimumCents=openingCents,minimumDate=input.asOf,firstNegativeDate:string|null=openingCents<0n?input.asOf:null;
 const daily=period.dates.map(date=>{
  const due=items.filter(i=>i.projectedDate===date),incomingCents=due.filter(i=>i.ledger==="RECEIVABLE").reduce((n,i)=>n+i.cents,0n),outgoingCents=due.filter(i=>i.ledger==="PAYABLE").reduce((n,i)=>n+i.cents,0n),openingCents=balance;
  balance+=incomingCents-outgoingCents;if(balance<minimumCents){minimumCents=balance;minimumDate=date;}if(balance<0n&&firstNegativeDate===null)firstNegativeDate=date;
  return {date,openingCents,incomingCents,outgoingCents,closingCents:balance};
 });
 const subledger=(ledger:ForecastLedger)=>input.items.filter(i=>i.ledger===ledger).reduce((n,i)=>n+(i.kind==="INVOICE"||i.kind==="REFUND"?i.cents:-i.cents),0n);
 return {...period,accounts:[...input.accounts],items,daily,openingCents,closingCents:balance,minimumCents,minimumDate,firstNegativeDate,
  incomingCents:daily.reduce((n,d)=>n+d.incomingCents,0n),outgoingCents:daily.reduce((n,d)=>n+d.outgoingCents,0n),negativeDays:daily.filter(d=>d.closingCents<0n).length,
  carriedCount:items.filter(i=>i.carried).length,excludedCount:input.items.filter(i=>i.kind!=="INVOICE").length,beyondCount:input.items.filter(i=>i.kind==="INVOICE"&&(i.dueDate??i.date)>period.to).length,
  receivableDifferenceCents:input.receivableControlCents-subledger("RECEIVABLE"),payableDifferenceCents:input.payableControlCents-subledger("PAYABLE"),futureCashCount:input.futureCashCount,futureCashCents:input.futureCashCents};
}
export type CashForecast=ReturnType<typeof buildCashForecast>;
/** Only chart coordinates become small integers; financial values stay exact BigInt cents. */
export function forecastChart(r:Pick<CashForecast,"openingCents"|"daily">){
 const values=[r.openingCents,...r.daily.map(d=>d.closingCents)],min=values.reduce((n,v)=>v<n?v:n,0n),max=values.reduce((n,v)=>v>n?v:n,0n),span=max-min||1n;
 const y=(v:bigint)=>160-Number((v-min)*140n/span);
 return {points:values.map((v,i)=>`${20+Math.trunc(i*680/(values.length-1||1))},${y(v)}`).join(' '),zero:y(0n),min,max};
}
export type ForecastCsvLabels=Record<"title"|"scope"|"asOf"|"end"|"opening"|"incoming"|"outgoing"|"closing"|"minimum"|"negativeDays"|"excluded"|"beyond"|"future"|"receivableDifference"|"payableDifference"|"daily"|"date"|"detail"|"projectedDate"|"kind"|"number"|"party"|"documentDate"|"dueDate"|"carried"|"amount"|"invoice"|"bill"|"yes"|"no"|"accounts"|"code"|"account",string>;
export function cashForecastCsv(r:CashForecast,l:ForecastCsvLabels,locale:Locale){
 const rows:CsvCell[][]=[[l.title],[l.scope],[l.asOf,r.asOf],[l.end,r.to],[l.opening,r.openingCents],[l.incoming,r.incomingCents],[l.outgoing,r.outgoingCents],[l.closing,r.closingCents],[l.minimum,r.minimumDate,r.minimumCents],[l.negativeDays,String(r.negativeDays)],[l.excluded,String(r.excludedCount)],[l.beyond,String(r.beyondCount)],[l.future,String(r.futureCashCount),r.futureCashCents],[l.receivableDifference,r.receivableDifferenceCents],[l.payableDifference,r.payableDifferenceCents],[l.daily],[l.date,l.opening,l.incoming,l.outgoing,l.closing],...r.daily.map(d=>[d.date,d.openingCents,d.incomingCents,d.outgoingCents,d.closingCents]),[l.detail],[l.projectedDate,l.kind,l.number,l.party,l.documentDate,l.dueDate,l.carried,l.amount],...r.items.map(i=>[i.projectedDate,i.ledger==='RECEIVABLE'?l.invoice:l.bill,i.number??'',i.party,i.date,i.dueDate??'',i.carried?l.yes:l.no,i.cents]),[l.accounts],[l.code,l.account,l.opening],...r.accounts.map(a=>[a.code,locale==='en'?a.nameEn:a.nameFr,a.cents])];
 return toCsv(rows,csvFormatFor(locale));
}
