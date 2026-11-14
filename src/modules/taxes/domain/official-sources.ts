import { isValidIsoDate } from "@/modules/ledger/client";
import { percentageRate } from "./calculation";
export const PROVINCES = ["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"] as const;
export type Province = (typeof PROVINCES)[number];
export const CRA_URL = "https://open.canada.ca/data/api/3/action/datastore_search?resource_id=e8f2d0c6-ca67-43d3-862b-6267603dacf6&limit=100";
export const CRA_PAGE = "https://open.canada.ca/data/en/dataset/5584a2cf-12af-4b2d-aff5-418410cf5375";
export const RQ_URL = "https://www.revenuquebec.ca/fr/entreprises/taxes/tpstvh-et-tvq/regles-de-base-relatives-a-lapplication-de-la-tpstvh-et-de-la-tvq/historique-des-taux/";
export const COVERAGE_FROM = "2013-04-01";
export type OfficialRate = { from: string; to: string | null; percent: string; rate: string };
export type SourcePeriod = { id: "CRA_GST_HST" | "RQ_QST"; url: string; sha256: string; collectedAt: string; rates: OfficialRate[] };
export type OfficialPreview = { province: Province; date: string; fingerprint: string; sources: SourcePeriod[] };
export function officialScope(province: string, date: string, today: string) {
  if (!PROVINCES.includes(province as Province) || !isValidIsoDate(date) || date < COVERAGE_FROM || date > today) throw new RangeError("officialTaxes.invalid");
  return { province: province as Province, date };
}
const periods = [
  { key: "VPR4_HST", from: "2013-04-01", to: "2016-06-30", note: "(HST) April 1, 2013 to June 30, 2016" },
  { key: "VPR3_HST", from: "2016-07-01", to: "2016-09-30", note: "(HST) July 1, 2016 to September 30, 2016" },
  { key: "VPR2_HST", from: "2016-10-01", to: "2025-03-31", note: "(HST) October 1, 2016 to March 31, 2025" },
  { key: "VPR1_HST", from: "2025-04-01", to: null, note: "(HST) On or after April 1, 2025" },
];
function percentage(value: unknown) {
  if (typeof value !== "string" || !/^\d{1,2}(?:[.,]\d{1,4})?\s*%$/.test(value)) throw new RangeError("officialTaxes.schema");
  const percent = value.replace(/\s|%/g, "").replace(",", ".");
  return { percent, rate: percentageRate(percent) };
}
/** Dates are part of the reviewed API contract. A changed column meaning requires a reviewed adapter update. */
export function parseCraRates(value: unknown): Record<Province, OfficialRate[]> {
  const data = value as { success?: boolean; result?: { resource_id?: string; total?: number; records?: Record<string, unknown>[]; fields?: {id:string;info?:{notes_en?:string}}[] } } | null;
  const result = data?.result;
  if (data?.success !== true || result?.resource_id !== "e8f2d0c6-ca67-43d3-862b-6267603dacf6" || result.total !== 13 || !Array.isArray(result.records) || result.records.length !== 13 || !Array.isArray(result.fields)) throw new RangeError("officialTaxes.schema");
  for (const period of periods) {
    const fields=result.fields.filter(field=>field?.id===period.key);
    if(fields.length!==1 || fields[0]?.info?.notes_en!==period.note) throw new RangeError("officialTaxes.schema");
  }
  if (result.fields.filter(f=>/^VPR\d+_HST$/.test(f?.id)).length!==4) throw new RangeError("officialTaxes.schema");
  const output = {} as Record<Province, OfficialRate[]>;
  for (const row of result.records) {
    const province=row?.JRSD_CD as Province;
    if (!PROVINCES.includes(province) || output[province]) throw new RangeError("officialTaxes.schema");
    // HST includes its federal component; PST columns are not standalone provincial rates.
    output[province] = periods.map(({key,from,to})=>({from,to,...percentage(row[key])}));
  }
  return output;
}
const months=["janvier","février","mars","avril","mai","juin","juillet","août","septembre","octobre","novembre","décembre"];
function frenchDate(text:string) {
  const match=/^(\d{1,2})(?:er)? (\S+) (\d{4})$/.exec(text);
  if(!match)throw new RangeError("officialTaxes.schema");
  const month=months.indexOf(match[2]!)+1;
  const iso=`${match[3]}-${String(month).padStart(2,"0")}-${match[1]!.padStart(2,"0")}`;
  if(!isValidIsoDate(iso))throw new RangeError("officialTaxes.schema");return iso;
}
const text=(html:string)=>html.replace(/<[^>]*>/g,"").replace(/&nbsp;|&#160;|&#xA0;/gi," ").replace(/\s+/g," ").trim();
/** Read only the historical TVQ table; pre-2013 compounding regimes are deliberately outside this adapter. */
export function parseRqRates(html:string): OfficialRate[] {
  const tables=[...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)].map(m=>m[0]).filter(table=>/<caption\b[^>]*>\s*Taux de la TVQ\s*<\/caption>/i.test(table));
  if(tables.length!==1)throw new RangeError("officialTaxes.schema");
  const rates:OfficialRate[]=[];
  for(const row of tables[0]!.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells=[...row[1]!.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m=>text(m[1]!));
    if(!cells.length)continue;
    if(cells.length!==2)throw new RangeError("officialTaxes.schema");
    const since=/^Depuis le (.+)$/.exec(cells[0]!),range=/^Du (.+) au (.+)$/.exec(cells[0]!);
    if(!since&&!range)throw new RangeError("officialTaxes.schema");
    const from=frenchDate(since?.[1]??range![1]!),to=since?null:frenchDate(range![2]!);
    if(from<"2013-01-01")continue;
    rates.push({from,to,...percentage(cells[1])});
  }
  rates.sort((a,b)=>a.from.localeCompare(b.from));
  if(rates[0]?.from!=="2013-01-01" || rates.at(-1)?.to!==null)throw new RangeError("officialTaxes.schema");
  for(let i=0;i<rates.length;i++) {
    const r=rates[i]!;
    if((r.to&&r.to<r.from)||(i<rates.length-1&&(!r.to||new Date(`${r.to}T00:00:00Z`).getTime()+86400000!==new Date(`${rates[i+1]!.from}T00:00:00Z`).getTime())))throw new RangeError("officialTaxes.schema");
  }
  return rates;
}
