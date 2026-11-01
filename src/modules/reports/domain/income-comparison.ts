import { roundDiv,type Locale } from "@/modules/ledger/client";
import type { IncomeStatement,StatementLine,StatementSection } from "./statements";
import { csvFormatFor,toCsv,type CsvCell } from "./csv";
export const COMPARISON_SECTIONS=["operatingRevenue","costOfSales","operatingExpenses","otherRevenue","otherExpenses"] as const;
export type ComparisonSectionKey=typeof COMPARISON_SECTIONS[number];
export type ComparedAmount={currentCents:bigint;referenceCents:bigint;differenceCents:bigint;percentHundredths:bigint|null};
export type ComparisonLine=Omit<StatementLine,"cents">&ComparedAmount;
export type ComparisonSection={lines:ComparisonLine[];total:ComparedAmount};
export type IncomeComparison={current:{from:string;to:string};reference:{from:string;to:string};sections:Record<ComparisonSectionKey,ComparisonSection>;grossProfit:ComparedAmount;operatingIncome:ComparedAmount;netIncome:ComparedAmount};
/** Percentages are meaningful only on a strictly positive reference. Round half away from zero. */
export function compareAmount(currentCents:bigint,referenceCents:bigint):ComparedAmount{
 const differenceCents=currentCents-referenceCents;
 return {currentCents,referenceCents,differenceCents,percentHundredths:referenceCents>0n?roundDiv(differenceCents*10_000n,referenceCents):null};
}
function compareSection(current:StatementSection,reference:StatementSection):ComparisonSection{
 const byId=new Map<string,{line:StatementLine;current:bigint;reference:bigint}>();
 for(const line of reference.lines)byId.set(line.accountId,{line,current:0n,reference:line.cents});
 for(const line of current.lines){const old=byId.get(line.accountId);byId.set(line.accountId,{line,current:line.cents,reference:old?.reference??0n});}
 const lines=[...byId.values()].map(r=>({accountId:r.line.accountId,code:r.line.code,nameFr:r.line.nameFr,nameEn:r.line.nameEn,...compareAmount(r.current,r.reference)})).sort((a,b)=>a.code.localeCompare(b.code)||a.accountId.localeCompare(b.accountId));
 return {lines,total:compareAmount(current.totalCents,reference.totalCents)};
}
export function buildIncomeComparison(current:IncomeStatement,reference:IncomeStatement,periods:Pick<IncomeComparison,"current"|"reference">):IncomeComparison{
 const sections=Object.fromEntries(COMPARISON_SECTIONS.map(k=>[k,compareSection(current[k],reference[k])])) as IncomeComparison["sections"];
 return {...periods,sections,grossProfit:compareAmount(current.grossProfitCents,reference.grossProfitCents),operatingIncome:compareAmount(current.operatingIncomeCents,reference.operatingIncomeCents),netIncome:compareAmount(current.netIncomeCents,reference.netIncomeCents)};
}
/** Numeric text, two decimals, without floating point or locale-dependent grouping. */
export function comparisonPercent(value:bigint|null,locale:Locale):string{
 if(value===null)return "";
 const abs=value<0n?-value:value;
 return `${value<0n?"-":""}${abs/100n}${locale==="en"?".":","}${String(abs%100n).padStart(2,"0")}`;
}
export type ComparisonLabels={code:string;account:string;current:string;reference:string;difference:string;percent:string;total:string;grossProfit:string;operatingIncome:string;netIncome:string}&Record<ComparisonSectionKey,string>;
export function incomeComparisonCsv(report:IncomeComparison,title:string,l:ComparisonLabels,locale:Locale){
 const rows:CsvCell[][]=[[title],[l.current,report.current.from,report.current.to],[l.reference,report.reference.from,report.reference.to],[l.code,l.account,l.current,l.reference,l.difference,l.percent]];
 const values=(a:ComparedAmount):CsvCell[]=>[a.currentCents,a.referenceCents,a.differenceCents,a.percentHundredths??""];
 for(const key of COMPARISON_SECTIONS){const s=report.sections[key];rows.push([l[key]]);for(const r of s.lines)rows.push([r.code,locale==="en"?r.nameEn:r.nameFr,...values(r)]);rows.push(["",l.total,...values(s.total)]);if(key==="costOfSales")rows.push(["",l.grossProfit,...values(report.grossProfit)]);if(key==="operatingExpenses")rows.push(["",l.operatingIncome,...values(report.operatingIncome)]);}
 rows.push(["",l.netIncome,...values(report.netIncome)]);
 return toCsv(rows,csvFormatFor(locale));
}
