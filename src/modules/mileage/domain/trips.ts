import { z } from "zod";
import { isValidIsoDate, type Locale } from "@/modules/ledger/client";
import { toCsv, csvFormatFor, type CsvCell } from "@/modules/reports/client";

export const MILEAGE_PAGE_SIZE = 50;
export const MILEAGE_EXPORT_LIMIT = 5000;
export const MILEAGE_PRINT_LIMIT = 1000;
export const MAX_TRIP_METERS = 10000000;
export const TRIP_USES = ["BUSINESS", "PERSONAL"] as const;
const line = (min: number, max: number) => z.string().refine(s => !/[\p{Cc}\p{Zl}\p{Zp}]/u.test(s)).transform(s => s.trim()).refine(s => [...s].length >= min && [...s].length <= max);
export const tripInput = z.object({
  date: z.string().refine(isValidIsoDate), vehicle: line(1,80), origin: line(1,160), destination: line(1,160),
  purpose: line(0,200), usage: z.enum(TRIP_USES), distanceMeters: z.number().int().min(1).max(MAX_TRIP_METERS),
}).refine(v => v.usage !== "BUSINESS" || v.purpose.length > 0);
export type TripInput = z.infer<typeof tripInput>;
export type MileageTrip = TripInput & {id:string;revision:number};
export type MileageFilters = {from:string;to:string;vehicle:string;usage:"ALL"|typeof TRIP_USES[number];page:number};

/** Distances are integer metres. Locale-specific input never passes through floating-point kilometres. */
export function parseKilometers(value: string, locale: Locale): number | null {
  const text=value.trim(),match=(locale==="en"?/^(\d+)(?:\.(\d{1,3}))?$/:/^(\d+)(?:[.,](\d{1,3}))?$/).exec(text);
  if(!match || match[1]!.length>5)return null;
  const meters=BigInt(match[1]!)*1000n+BigInt((match[2]??"").padEnd(3,"0"));
  return meters>=1n&&meters<=BigInt(MAX_TRIP_METERS)?Number(meters):null;
}
export function kilometers(value: bigint|number, locale: Locale, grouped=true): string {
  const meters=BigInt(value);if(meters<0n)throw new RangeError("negative mileage");
  const whole=(meters/1000n).toString(),decimal=locale==="en"?".":",";
  return `${grouped?whole.replace(/\B(?=(\d{3})+(?!\d))/g,locale==="en"?",":"\u00a0"):whole}${decimal}${(meters%1000n).toString().padStart(3,"0")}`;
}
export function mileageFilters(q:Record<string,string|string[]|undefined>,today:string):MileageFilters {
  const one=(key:string,fallback:string)=>{const value=q[key];if(value===undefined)return fallback;if(typeof value!=="string")throw new RangeError("mileage filters");return value;};
  const from=one("du",today.slice(0,4)+"-01-01"),to=one("au",today),vehicleText=one("vehicule",""),vehicle=vehicleText.trim(),usage=one("usage","ALL"),page=one("page","1");
  if(!isValidIsoDate(from)||!isValidIsoDate(to)||from>to||to>today||(Date.parse(to+"T00:00:00Z")-Date.parse(from+"T00:00:00Z"))/86400000>365||[...vehicle].length>80||/[\p{Cc}\p{Zl}\p{Zp}]/u.test(vehicleText)||!['ALL',...TRIP_USES].includes(usage)||!/^[1-9]\d*$/.test(page)||!Number.isSafeInteger(Number(page)))throw new RangeError("mileage filters");
  return {from,to,vehicle,usage:usage as MileageFilters['usage'],page:Number(page)};
}
export function mileageQuery(f: MileageFilters, page?:number) {
  const q=new URLSearchParams({du:f.from,au:f.to});if(f.vehicle)q.set("vehicule",f.vehicle);if(f.usage!=="ALL")q.set("usage",f.usage);if(page!==undefined)q.set("page",String(page));return q.toString();
}
export function tripYearFilters(date:string,today:string):MileageFilters {
  return {from:date.slice(0,4)+"-01-01",to:date.slice(0,4)===today.slice(0,4)?today:date.slice(0,4)+"-12-31",vehicle:"",usage:"ALL",page:1};
}
export type MileageReport={filters:MileageFilters;rows:MileageTrip[];count:number;page:number;pageCount:number;businessMeters:bigint;personalMeters:bigint};
type Labels="title"|"shared"|"from"|"to"|"vehicle"|"usage"|"ALL"|"BUSINESS"|"PERSONAL"|"date"|"origin"|"destination"|"purpose"|"distance"|"total"|"count";
export function mileageCsv(r:MileageReport,locale:Locale,t:(key:Labels)=>string) {
  if(r.rows.length!==r.count||r.count>MILEAGE_EXPORT_LIMIT)throw new RangeError("incomplete mileage export");
  // Kilometres are numeric strings, not BigInt CSV cells (those represent financial cents).
  const rows:CsvCell[][]=[[t("title")],[t("shared")],[t("from"),r.filters.from],[t("to"),r.filters.to],[t("vehicle"),r.filters.vehicle],[t("usage"),t(r.filters.usage)],[t("date"),t("vehicle"),t("usage"),t("origin"),t("destination"),t("purpose"),t("distance")],
    ...r.rows.map(a=>[a.date,a.vehicle,t(a.usage),a.origin,a.destination,a.purpose,kilometers(a.distanceMeters,locale,false)]),
    [t("count"),String(r.count)],[t("BUSINESS"),kilometers(r.businessMeters,locale,false)],[t("PERSONAL"),kilometers(r.personalMeters,locale,false)],[t("total"),kilometers(r.businessMeters+r.personalMeters,locale,false)]];
  return toCsv(rows,csvFormatFor(locale));
}
