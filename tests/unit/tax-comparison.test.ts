import { expect, it } from "vitest";
import { buildTaxComparison, resolveTaxComparisonPeriods, taxComparisonParams, taxComparisonCsv, type TaxComparisonLabels, type TaxComparisonSide } from "@/modules/reports/client";
const today = "2026-11-16";
it("uses previous calendar months, quarters and years with exact leap boundaries", () => {
 for (const [frequence,date,from,to,refFrom,refTo] of [
  ["MONTH","2024-03-15","2024-03-01","2024-03-31","2024-02-01","2024-02-29"],
  ["MONTH","2024-02-29","2024-02-01","2024-02-29","2024-01-01","2024-01-31"],
  ["QUARTER","2026-01-15","2026-01-01","2026-03-31","2025-10-01","2025-12-31"],
  ["YEAR","2025-01-01","2025-01-01","2025-12-31","2024-01-01","2024-12-31"],
 ]) expect(resolveTaxComparisonPeriods({frequence,date},[],today)).toEqual({current:{from,to},reference:{from:refFrom,to:refTo}});
});
it("keeps custom and explicit reference periods, including overlap and unequal duration", () => {
 const p = resolveTaxComparisonPeriods({du:"2024-03-01",au:"2024-03-02"},[],today);
 expect(p.reference).toEqual({from:"2024-02-28",to:"2024-02-29"});
 const exact={du:"2026-06-01",au:"2026-06-30",du_ref:"2026-06-15",au_ref:"2026-07-31"};
 expect(taxComparisonParams(resolveTaxComparisonPeriods(exact,[],today))).toEqual(exact);
 expect(resolveTaxComparisonPeriods({},[{start:"2026-04-01",end:"2027-03-31"}],today).current).toEqual({from:"2026-04-01",to:today});
});
it("refuses incomplete, repeated, contradictory and unsupported parameters without fallback", () => {
 for (const q of [{du_ref:"2026-01-01"},{du_ref:"",au_ref:""},{du_ref:["2026-01-01"],au_ref:"2026-01-31"},{du_ref:"2026-02-30",au_ref:"2026-03-31"},{du_ref:"2026-02-01",au_ref:"2026-01-31"},{du:"2026-01-01"},{du:["2026-01-01"],au:"2026-01-31"},{frequence:"MONTH",date:"2026-01-01",du:"2026-01-01"},{frequence:["MONTH"],date:"2026-01-01"},{date:"2026-02-30",frequence:"MONTH"},{page:"2"},{unknown:"a"}]) expect(()=>resolveTaxComparisonPeriods(q,[],today)).toThrow(RangeError);
});
it("compares exact cents with no floating point and exports only safe aggregate fields", () => {
 const large=9007199254740993n;
 const current:TaxComparisonSide={taxes:[{id:"PRIVATE-ID",code:'=HYPERLINK("test")',nameFr:"PRIVATE-NAME",nameEn:"PRIVATE-NAME",collectedCents:large,recoverableCents:1n,adjustmentCents:2n,netCents:large+1n,settlementCents:-3n,movementCents:large-2n}],controlCents:large-2n,differenceCents:0n,anomalyCount:0,lineCount:1};
 const reference:TaxComparisonSide={taxes:[],controlCents:0n,differenceCents:0n,anomalyCount:2,lineCount:0};
 const report=buildTaxComparison({current:{from:"2026-01-01",to:"2026-01-31"},reference:{from:"2025-12-01",to:"2025-12-31"}},current,reference);
 expect(report.totals.netCents).toMatchObject({currentCents:large+1n,referenceCents:0n,differenceCents:large+1n});
 const labels=Object.fromEntries(["title","current","reference","difference","tax","metric","total","control","reconciliation","anomalies","lines","scope","collectedCents","recoverableCents","adjustmentCents","netCents","settlementCents","movementCents"].map(key=>[key,key])) as TaxComparisonLabels;
 const en=taxComparisonCsv(report,labels,"en"),fr=taxComparisonCsv(report,labels,"fr-CA");
 expect(en).toContain('90071992547409.93'); expect(fr).toContain('90071992547409,93'); expect(en).toContain("'=HYPERLINK"); expect(en).toContain('""test""');
 for (const secret of ["PRIVATE-ID","PRIVATE-NAME","memo","accountId","entryId"]) expect(en).not.toContain(secret);
 expect(report.reference.anomalyCount).toBe(2);
});
