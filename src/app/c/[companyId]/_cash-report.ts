import "server-only";
import { notFound } from "next/navigation";
import { searchText } from "@/app/_lib/search-params";
import type { getTranslations } from "next-intl/server";
import { CASH_FIGURES,type CashCsvLabels } from "@/modules/reports";
export function cashAccountId(value:string|string[]|undefined){
 if(Array.isArray(value)&&value.length!==1)notFound();
 const id=(Array.isArray(value)?value[0]:value)?.trim();if(!id)return undefined;
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))notFound();return id.toLowerCase();
}
export function cashPage(value:string|string[]|undefined){const n=Number(searchText(value));return Number.isSafeInteger(n)&&n>0?n:1;}
export function cashCsvLabels(t:Awaited<ReturnType<typeof getTranslations<"cashReport">>>):CashCsvLabels{
 return {...Object.fromEntries(CASH_FIGURES.map(k=>[k,t(k)])),...Object.fromEntries(["account","total","date","entry","memo","kind","debit","credit","net","control","detail","mixedCount","scope","movement","transfer","mixed"].map(k=>[k,t(k as "scope")]))} as CashCsvLabels;
}
