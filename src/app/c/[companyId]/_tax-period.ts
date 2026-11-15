import { notFound } from "next/navigation";
import { resolveTaxReportPeriod, type TaxReportPeriod } from "@/modules/reports";

export function taxPeriod(query: Record<string,string|string[]|undefined>, years: readonly { start:string;end:string }[], today:string): TaxReportPeriod {
  try { return resolveTaxReportPeriod(query,years,today); }
  catch(error) { if(error instanceof RangeError)notFound(); throw error; }
}

/** Preserve repeated parameters for validation rather than keeping just one URL value. */
export function taxPeriodQuery(search: URLSearchParams): Record<string,string|string[]> {
  return Object.fromEntries([...new Set(search.keys())].map(key=>{
    const values=search.getAll(key);return [key,values.length===1 ? values[0]! : values];
  }));
}
