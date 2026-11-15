import { expect, it } from "vitest";
import { resolveTaxReportPeriod, taxCalendarPeriod, taxReportPeriodParams } from "@/modules/reports/client";

it("selects exact calendar months, leap-year boundaries and all four quarters without timezone arithmetic",()=>{
 expect(taxCalendarPeriod("MONTH","2024-02-17")).toEqual({from:"2024-02-01",to:"2024-02-29"});
 expect(taxCalendarPeriod("MONTH","1900-02-01")).toEqual({from:"1900-02-01",to:"1900-02-28"});
 expect(taxCalendarPeriod("MONTH","2000-02-29")).toEqual({from:"2000-02-01",to:"2000-02-29"});
 for(const [date,from,to] of [["2026-01-01","2026-01-01","2026-03-31"],["2026-06-30","2026-04-01","2026-06-30"],["2026-08-19","2026-07-01","2026-09-30"],["2026-12-31","2026-10-01","2026-12-31"]])expect(taxCalendarPeriod("QUARTER",date!)).toEqual({from,to});
 expect(taxCalendarPeriod("YEAR","2024-02-29")).toEqual({from:"2024-01-01",to:"2024-12-31"});
 expect(()=>taxCalendarPeriod("MONTH","2026-02-29")).toThrow();expect(()=>taxCalendarPeriod("invalid" as never,"2026-01-01")).toThrow();
});
it("preserves explicit filing ranges and preset parameters for exports and pagination",()=>{
 const selected=resolveTaxReportPeriod({frequence:"QUARTER",date:"2026-06-30"},[],"2026-11-15");
 expect(selected).toEqual({from:"2026-04-01",to:"2026-06-30",frequency:"QUARTER",referenceDate:"2026-06-30"});
 expect(taxReportPeriodParams(selected)).toEqual({frequence:"QUARTER",date:"2026-06-30"});
 const custom=resolveTaxReportPeriod({du:"2026-02-01",au:"2026-04-30"},[],"2026-11-15");
 expect(custom.frequency).toBe("CUSTOM");expect(taxReportPeriodParams(custom)).toEqual({du:"2026-02-01",au:"2026-04-30"});
});
it("retains the fiscal year-to-date default and refuses malformed periods without broadening the report",()=>{
 expect(resolveTaxReportPeriod({},[{start:"2026-04-01",end:"2027-03-31"}],"2026-11-15")).toMatchObject({from:"2026-04-01",to:"2026-11-15",frequency:"CUSTOM"});
 expect(resolveTaxReportPeriod({},[],"2026-11-15")).toMatchObject({from:"2026-01-01",to:"2026-11-15"});
 for(const query of [{du:"2026-01-01"},{du:"2026-02-30",au:"2026-03-31"},{du:"2026-03-01",au:"2026-02-28"},{du:["2026-01-01","2026-02-01"],au:"2026-03-31"},{frequence:"MONTH",date:["2026-01-01","2026-02-01"]},{frequence:"MONTH",date:"2026-01-01",du:"2026-01-01"},{frequence:"MONTH"},{date:"2026-01-01"},{frequence:"INVALID",date:"2026-01-01"},{frequence:"MONTH",date:"2026-02-30"},{frequence:""}])expect(()=>resolveTaxReportPeriod(query,[],"2026-11-15")).toThrow(RangeError);
});
