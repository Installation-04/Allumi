import { cashForecastRange } from "@/modules/reports/client";
import { AppError } from "@/platform/errors";
/** One shared strict parser for the page and private CSV endpoint. */
export function forecastFilters(q:Record<string,string|string[]|undefined>,today:string){
 const one=(key:string,fallback:string)=>{const value=q[key];if(value===undefined)return fallback;if(typeof value!=="string"||value==="")throw new AppError("reports.forecastDate");return value;};
 const asOf=one("date",today),horizon=one("jours","30"),pageText=one("page","1");
 if(!/^(7|30|60|90)$/.test(horizon)||!/^[1-9][0-9]*$/.test(pageText)||!Number.isSafeInteger(Number(pageText))||asOf>today)throw new AppError("reports.forecastDate");
 const days=Number(horizon);try{cashForecastRange(asOf,days);}catch{throw new AppError("reports.forecastDate");}
 return {asOf,days,page:Number(pageText)};
}
