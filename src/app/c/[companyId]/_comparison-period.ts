import { isValidIsoDate,type FiscalYearDto } from "@/modules/ledger";
import { statementPeriod } from "@/app/_lib/report-period";
import { searchText } from "@/app/_lib/search-params";
export function comparisonPeriod(query:Record<string,string|string[]|undefined>,years:readonly FiscalYearDto[],today:string){
 const current=statementPeriod(query,years,today);
 const from=searchText(query.du_ref),to=searchText(query.au_ref);
 if(from&&to&&isValidIsoDate(from)&&isValidIsoDate(to)&&from<=to)return {current,reference:{from,to}};
 const start=Date.parse(`${current.from}T00:00:00Z`),end=Date.parse(`${current.to}T00:00:00Z`),day=86_400_000;
 const priorTo=new Date(start-day).toISOString().slice(0,10),priorFrom=new Date(start-(end-start+day)).toISOString().slice(0,10);
 return {current,reference:isValidIsoDate(priorFrom)&&isValidIsoDate(priorTo)?{from:priorFrom,to:priorTo}:{...current}};
}
