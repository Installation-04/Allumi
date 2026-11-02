import { daysInMonth,parseIsoDate,isValidIsoDate } from "@/modules/ledger";
import { balanceDay } from "@/app/_lib/report-period";
import { searchText } from "@/app/_lib/search-params";
export function balanceComparisonDates(query:Record<string,string|string[]|undefined>,today:string){
 const asOf=balanceDay(query,today),given=searchText(query.au_ref);
 if(given&&isValidIsoDate(given))return {asOf,referenceAsOf:given};
 const date=parseIsoDate(asOf)!;
 const referenceAsOf=date.year>1900?`${date.year-1}-${String(date.month).padStart(2,"0")}-${String(Math.min(date.day,daysInMonth(date.year-1,date.month))).padStart(2,"0")}`:asOf;
 return {asOf,referenceAsOf};
}
