import { it,expect } from "vitest";
import { buildBalanceComparison,buildBalanceSheet,balanceComparisonCsv,type AccountTotals,type BalanceComparisonLabels } from "@/modules/reports";
import { balanceComparisonDates } from "@/app/c/[companyId]/_balance-comparison-dates";
const dates={current:{asOf:"2027-01-01",fiscalYearStart:"2027-01-01"},reference:{asOf:"2026-12-31",fiscalYearStart:"2026-01-01"}};
const account:AccountTotals={accountId:"bank",code:"1000",nameFr:"=2+2",nameEn:"@bank",type:"ASSET",subtype:"CURRENT_ASSET",debitCents:10000n,creditCents:0n};
it("defaults to the preceding year, clamps leap day and accepts either date order",()=>{
 expect(balanceComparisonDates({au:"2024-02-29"},"2026-11-01")).toEqual({asOf:"2024-02-29",referenceAsOf:"2023-02-28"});
 expect(balanceComparisonDates({au:"1900-01-01"},"2026-11-01").referenceAsOf).toBe("1900-01-01");
 expect(balanceComparisonDates({au:"2026-06-30",au_ref:"2027-12-31"},"2026-11-01").referenceAsOf).toBe("2027-12-31");
 expect(balanceComparisonDates({au:"2026-06-30",au_ref:"2026-02-30"},"2026-11-01").referenceAsOf).toBe("2025-06-30");
 expect(balanceComparisonDates({au:"bad"},"2026-11-01").asOf).toBe("2026-11-01");
});
it("preserves reference-only accounts and shows each imbalance without adjusting it",()=>{
 const r=buildBalanceComparison(buildBalanceSheet([]),buildBalanceSheet([account]),dates);
 expect(r.sections.currentAssets.lines[0]).toMatchObject({accountId:"bank",currentCents:0n,referenceCents:10000n,differenceCents:-10000n,percentHundredths:-10000n});
 expect(r.currentBalanced).toBe(true);expect(r.referenceBalanced).toBe(false);
 expect(r.balanceGap).toMatchObject({currentCents:0n,referenceCents:10000n,differenceCents:-10000n});
});
it("exports safe text, numeric negative percentages and empty undefined percentages in both locales",()=>{
 const r=buildBalanceComparison(buildBalanceSheet([]),buildBalanceSheet([account]),dates);
 const l:BalanceComparisonLabels={code:"Code",account:"Account",current:"Current",reference:"Reference",difference:"Difference",percent:"%",total:"Total",control:"Control",fiscalYearStart:"Fiscal start",none:"None",currentAssets:"Current assets",fixedAssets:"Fixed assets",otherAssets:"Other assets",currentLiabilities:"Current liabilities",longTermLiabilities:"Long term liabilities",equity:"Equity",totalAssets:"Assets",totalLiabilities:"Liabilities",priorEarnings:"Prior earnings",currentEarnings:"Current earnings",totalEquity:"Total equity",totalLiabilitiesAndEquity:"Liabilities and equity"};
 expect(balanceComparisonCsv(r,"Report",l,"fr-CA")).toContain("1000;'=2+2;0,00;100,00;-100,00;-100,00\r\n");
 expect(balanceComparisonCsv(r,"Report",l,"en")).toContain("1000,'@bank,0.00,100.00,-100.00,-100.00\r\n");
 expect(balanceComparisonCsv(r,"Report",l,"en")).toContain(",Liabilities,0.00,0.00,0.00,\r\n");
});
