import type { BalanceSheet } from "./statements";
import { compareAmount,compareStatementSection,type ComparedAmount,type ComparisonSection } from "./income-comparison";
import { csvFormatFor,toCsv,type CsvCell } from "./csv";
import type { Locale } from "@/modules/ledger/client";
export const BALANCE_COMPARISON_SECTIONS=["currentAssets","fixedAssets","otherAssets","currentLiabilities","longTermLiabilities","equity"] as const;
export const BALANCE_COMPARISON_FIGURES=["totalAssets","totalLiabilities","priorEarnings","currentEarnings","totalEquity","totalLiabilitiesAndEquity"] as const;
export type BalanceComparisonSection=typeof BALANCE_COMPARISON_SECTIONS[number];
export type BalanceComparisonFigure=typeof BALANCE_COMPARISON_FIGURES[number];
export type BalanceComparison={current:{asOf:string;fiscalYearStart:string|null};reference:{asOf:string;fiscalYearStart:string|null};sections:Record<BalanceComparisonSection,ComparisonSection>;figures:Record<BalanceComparisonFigure,ComparedAmount>;currentBalanced:boolean;referenceBalanced:boolean;balanceGap:ComparedAmount};
export function buildBalanceComparison(current:BalanceSheet,reference:BalanceSheet,dates:Pick<BalanceComparison,"current"|"reference">):BalanceComparison{
 const sections=Object.fromEntries(BALANCE_COMPARISON_SECTIONS.map(k=>[k,compareStatementSection(current[k],reference[k])])) as BalanceComparison["sections"];
 const figures=Object.fromEntries(BALANCE_COMPARISON_FIGURES.map(k=>[k,compareAmount(current[`${k}Cents`],reference[`${k}Cents`])])) as BalanceComparison["figures"];
 return {...dates,sections,figures,currentBalanced:current.balanced,referenceBalanced:reference.balanced,balanceGap:compareAmount(current.totalAssetsCents-current.totalLiabilitiesAndEquityCents,reference.totalAssetsCents-reference.totalLiabilitiesAndEquityCents)};
}
export type BalanceComparisonLabels={code:string;account:string;current:string;reference:string;difference:string;percent:string;total:string;control:string;fiscalYearStart:string;none:string}&Record<BalanceComparisonSection|BalanceComparisonFigure,string>;
export function balanceComparisonCsv(r:BalanceComparison,title:string,l:BalanceComparisonLabels,locale:Locale){
 const rows:CsvCell[][]=[[title],[l.current,r.current.asOf],[l.reference,r.reference.asOf],[l.fiscalYearStart,r.current.fiscalYearStart??l.none,r.reference.fiscalYearStart??l.none],[l.code,l.account,l.current,l.reference,l.difference,l.percent]];
 const values=(a:ComparedAmount):CsvCell[]=>[a.currentCents,a.referenceCents,a.differenceCents,a.percentHundredths??""];
 const section=(key:BalanceComparisonSection)=>{const s=r.sections[key];rows.push([l[key]]);for(const line of s.lines)rows.push([line.code,locale==="en"?line.nameEn:line.nameFr,...values(line)]);rows.push(["",l.total,...values(s.total)]);};
 const figure=(key:BalanceComparisonFigure)=>rows.push(["",l[key],...values(r.figures[key])]);
 for(const k of ["currentAssets","fixedAssets","otherAssets"] as const)section(k);figure("totalAssets");
 for(const k of ["currentLiabilities","longTermLiabilities"] as const)section(k);figure("totalLiabilities");
 section("equity");for(const k of ["priorEarnings","currentEarnings","totalEquity","totalLiabilitiesAndEquity"] as const)figure(k);
 rows.push(["",l.control,...values(r.balanceGap)]);
 return toCsv(rows,csvFormatFor(locale));
}
