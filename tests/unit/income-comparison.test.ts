import { it,expect } from "vitest";
import { compareAmount,comparisonPercent,buildIncomeComparison,incomeComparisonCsv,buildIncomeStatement,type ComparisonLabels,type AccountTotals } from "@/modules/reports";
import { comparisonPeriod } from "@/app/c/[companyId]/_comparison-period";
it("calculates exact signed differences and rounds percentages half away from zero",()=>{
 expect(compareAmount(150n,100n)).toMatchObject({differenceCents:50n,percentHundredths:5000n});expect(compareAmount(-100n,100n).percentHundredths).toBe(-20000n);
 expect(compareAmount(20001n,20000n).percentHundredths).toBe(1n);expect(compareAmount(19999n,20000n).percentHundredths).toBe(-1n);
 expect(compareAmount(9007199254740993n,9007199254740992n).differenceCents).toBe(1n);
 for(const ref of [0n,-100n])expect(compareAmount(50n,ref).percentHundredths).toBeNull();
 expect(comparisonPercent(-1250n,"fr-CA")).toBe("-12,50");expect(comparisonPercent(1n,"en")).toBe("0.01");expect(comparisonPercent(null,"en")).toBe("");
});
it("defaults to an equally long prior window across leap dates and preserves custom overlapping dates",()=>{
 expect(comparisonPeriod({du:"2024-03-01",au:"2024-03-31"},[],"2026-11-01").reference).toEqual({from:"2024-01-30",to:"2024-02-29"});
 expect(comparisonPeriod({du:"2026-06-01",au:"2026-06-30",du_ref:"2026-06-01",au_ref:"2026-06-30"},[],"2026-11-01").reference).toEqual({from:"2026-06-01",to:"2026-06-30"});
 expect(comparisonPeriod({du:"1900-01-01",au:"1900-01-31"},[],"2026-11-01").reference).toEqual({from:"1900-01-01",to:"1900-01-31"});
 expect(comparisonPeriod({du:"2026-06-01",au:"2026-06-30",du_ref:"bad",au_ref:"bad"},[],"2026-11-01").reference).toEqual({from:"2026-05-02",to:"2026-05-31"});
});
it("keeps reference-only rows and exports safe text with numeric negative percentages",()=>{
 const row:AccountTotals={accountId:"one",code:"4000",nameFr:"=2+2",nameEn:"@name",type:"REVENUE",subtype:"OPERATING_REVENUE",debitCents:0n,creditCents:10000n};
 const r=buildIncomeComparison(buildIncomeStatement([]),buildIncomeStatement([row]),{current:{from:"2026-07-01",to:"2026-07-31"},reference:{from:"2026-06-01",to:"2026-06-30"}});
 const l:ComparisonLabels={code:"Code",account:"Account",current:"Current",reference:"Reference",difference:"Difference",percent:"%",total:"Total",operatingRevenue:"Revenue",costOfSales:"Costs",operatingExpenses:"Expenses",otherRevenue:"Other revenue",otherExpenses:"Other expenses",grossProfit:"Gross profit",operatingIncome:"Operating income",netIncome:"Net income"};
 expect(r.sections.operatingRevenue.lines).toHaveLength(1);
 expect(incomeComparisonCsv(r,"Report",l,"fr-CA")).toContain("4000;'=2+2;0,00;100,00;-100,00;-100,00\r\n");
 expect(incomeComparisonCsv(r,"Report",l,"en")).toContain("4000,'@name,0.00,100.00,-100.00,-100.00\r\n");
});
