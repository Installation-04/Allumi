import type { Locale } from "@/modules/ledger/client";
import { csvFormatFor,toCsv,type CsvCell } from "./csv";
export const TAX_BOXES=["COLLECTED","RECOVERABLE","ADJUSTMENT","SETTLEMENT"] as const;
export type TaxSummaryLine={id:string;entryId:string;entryNumber:string;date:string;taxCode:string;box:typeof TAX_BOXES[number];accountCode:string;memo:string|null;debitCents:bigint;creditCents:bigint};
export type TaxSummaryRow={id:string;code:string;nameFr:string;nameEn:string;collectedCents:bigint;recoverableCents:bigint;adjustmentCents:bigint;settlementCents:bigint;netCents:bigint;movementCents:bigint};
export type TaxSummary={from:string;to:string;taxes:TaxSummaryRow[];controlCents:bigint;differenceCents:bigint;anomalyCount:number;lineCount:number;page:number;pageCount:number;lines:TaxSummaryLine[]};
export type TaxSummaryLabels={tax:string;collected:string;recoverable:string;adjustment:string;settlement:string;net:string;movement:string;total:string;control:string;difference:string;anomalies:string;detail:string;date:string;entry:string;account:string;memo:string;box:string;debit:string;credit:string;boxes:Record<typeof TAX_BOXES[number],string>};
export function taxSummaryTotals(rows:readonly TaxSummaryRow[]){
 return rows.reduce((a,r)=>({collectedCents:a.collectedCents+r.collectedCents,recoverableCents:a.recoverableCents+r.recoverableCents,adjustmentCents:a.adjustmentCents+r.adjustmentCents,settlementCents:a.settlementCents+r.settlementCents,netCents:a.netCents+r.netCents,movementCents:a.movementCents+r.movementCents}),{collectedCents:0n,recoverableCents:0n,adjustmentCents:0n,settlementCents:0n,netCents:0n,movementCents:0n});
}
/** Both summary and full detail, using exact amounts and the common formula-injection protection. */
export function taxSummaryCsv(report:TaxSummary,title:string,l:TaxSummaryLabels,locale:Locale){
 const rows:CsvCell[][]=[[title],[report.from,report.to],[l.tax,l.collected,l.recoverable,l.adjustment,l.net,l.settlement,l.movement]];
 const values=(r:ReturnType<typeof taxSummaryTotals>)=>[r.collectedCents,r.recoverableCents,r.adjustmentCents,r.netCents,r.settlementCents,r.movementCents];
 for(const r of report.taxes)rows.push([r.code,...values(r)]);
 rows.push([l.total,...values(taxSummaryTotals(report.taxes))],[l.control,report.controlCents],[l.difference,report.differenceCents],[l.anomalies,String(report.anomalyCount)],[],[l.detail],[l.date,l.entry,l.tax,l.box,l.account,l.memo,l.debit,l.credit,l.movement]);
 for(const r of report.lines)rows.push([r.date,r.entryNumber,r.taxCode,l.boxes[r.box],r.accountCode,r.memo??"",r.debitCents,r.creditCents,r.creditCents-r.debitCents]);
 return toCsv(rows,csvFormatFor(locale));
}
