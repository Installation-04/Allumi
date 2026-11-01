import { it,expect } from "vitest";
import { taxSummaryCsv,taxSummaryTotals,type TaxSummary,type TaxSummaryLabels,type TaxSummaryRow } from "@/modules/reports";
const tax:TaxSummaryRow={id:"tax",code:"TPS",nameFr:"TPS",nameEn:"GST",collectedCents:10001n,recoverableCents:42n,adjustmentCents:0n,netCents:9959n,settlementCents:-500n,movementCents:9459n};
const labels:TaxSummaryLabels={tax:"Tax",collected:"Collected",recoverable:"Recoverable",adjustment:"Adjustment",settlement:"Settlement",net:"Net",movement:"Movement",total:"Total",control:"Control",difference:"Difference",anomalies:"Anomalies",detail:"Detail",date:"Date",entry:"Entry",account:"Account",memo:"Memo",box:"Category",debit:"Debit",credit:"Credit",boxes:{COLLECTED:"Collected",RECOVERABLE:"Recoverable",ADJUSTMENT:"Adjustment",SETTLEMENT:"Settlement"}};
const report:TaxSummary={from:"2026-06-01",to:"2026-06-30",taxes:[tax],controlCents:9459n,differenceCents:0n,anomalyCount:0,lineCount:1,page:1,pageCount:1,lines:[{id:"line",entryId:"entry",entryNumber:"1",date:"2026-06-01",taxCode:"TPS",box:"RECOVERABLE",accountCode:"1200",memo:"Memo",debitCents:42n,creditCents:0n}]};
it("exports exact signed summary, controls and detail with locale-specific separators",()=>{
 const fr=taxSummaryCsv(report,"Taxes",labels,"fr-CA");expect(fr).toContain("TPS;100,01;0,42;0,00;99,59;-5,00;94,59\r\n");expect(fr).toContain("Control;94,59\r\n");expect(fr).toContain("2026-06-01;1;TPS;Recoverable;1200;Memo;0,42;0,00;-0,42\r\n");
 const en=taxSummaryCsv(report,"Taxes",labels,"en");expect(en).toContain("TPS,100.01,0.42,0.00,99.59,-5.00,94.59\r\n");
});
it("protects untrusted text and preserves integer precision beyond Number.MAX_SAFE_INTEGER",()=>{
 const text=taxSummaryCsv({...report,taxes:[{...tax,code:"@unsafe"}],lines:[{...report.lines[0]!,memo:'=SUM(1,2)\n"quoted"'}]},"Taxes",labels,"en");expect(text).toContain("'@unsafe,");expect(text).toContain('"\'=SUM(1,2)\n""quoted"""');
 const huge={...tax,collectedCents:9007199254740993n,netCents:9007199254740951n,movementCents:9007199254740451n};expect(taxSummaryTotals([huge,huge]).collectedCents).toBe(18014398509481986n);expect(taxSummaryTotals([]).netCents).toBe(0n);
});
