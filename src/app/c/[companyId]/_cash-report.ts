import "server-only";
import { searchText } from "@/app/_lib/search-params";
import type { getTranslations } from "next-intl/server";
import { CASH_FIGURES,type CashCsvLabels } from "@/modules/reports";
export { reportAccountId as cashAccountId } from "@/app/_lib/report-account";
export function cashPage(value:string|string[]|undefined){const n=Number(searchText(value));return Number.isSafeInteger(n)&&n>0?n:1;}
export function cashCsvLabels(t:Awaited<ReturnType<typeof getTranslations<"cashReport">>>):CashCsvLabels{
 return {...Object.fromEntries(CASH_FIGURES.map(k=>[k,t(k)])),...Object.fromEntries(["account","total","date","entry","memo","kind","debit","credit","net","control","detail","mixedCount","scope","movement","transfer","mixed"].map(k=>[k,t(k as "scope")]))} as CashCsvLabels;
}
