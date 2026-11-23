import { ACCOUNT_CODE } from "@/modules/ledger/client";
import { allocationSummary } from "./monthly";
import { BudgetCsvError,readBudgetCsvAmount,readBudgetCsvRecords,type BudgetCsvFormat,type BudgetCsvIssue } from "./import-csv";
export const MAX_MONTHLY_IMPORT_ACCOUNTS=250;
export const MONTHLY_CSV_HEADER=["account_code",...Array.from({length:12},(_,i)=>`period_${i+1}`)];
export type MonthlyCsvIssue=BudgetCsvIssue|"annual"|"excess";
export class MonthlyCsvError extends Error {
  constructor(readonly code:MonthlyCsvIssue,readonly row=0){super(code);this.name="MonthlyCsvError";}
}
export type MonthlyImportAccount={id:string;code:string;nameFr:string;nameEn:string;type:"REVENUE"|"EXPENSE";isActive:boolean;annualCents:string;months:(string|null)[]};
export type MonthlyCsvTarget={row:number;accountCode:string;months:(bigint|null)[]};
export type MonthlyImportPreview=MonthlyCsvTarget&{accountId:string;nameFr:string;nameEn:string;type:"REVENUE"|"EXPENSE";annualCents:bigint;before:(bigint|null)[];allocatedCents:bigint;remainingCents:bigint;definedCount:number;changedCount:number;removedCount:number};
export type MonthlyImportReview={accountId:string;accountCode:string;months:(string|null)[]};
export function readMonthlyBudgetCsv(text:string,format:BudgetCsvFormat):MonthlyCsvTarget[]{
  try {
    const records=readBudgetCsvRecords(text,format,{columns:13,rows:MAX_MONTHLY_IMPORT_ACCOUNTS}),header=records.shift();
    if(!header||header.cells.length!==13||header.cells.some((cell,i)=>cell!==MONTHLY_CSV_HEADER[i]))throw new MonthlyCsvError("header",header?.line??1);
    if(!records.length)throw new MonthlyCsvError("empty");
    const seen=new Set<string>();
    return records.map(r=>{
      if(r.cells.length!==13)throw new MonthlyCsvError("columns",r.line);
      const code=r.cells[0]!;
      if(!ACCOUNT_CODE.test(code))throw new MonthlyCsvError("code",r.line);
      if(seen.has(code))throw new MonthlyCsvError("duplicate",r.line);seen.add(code);
      return {row:r.line,accountCode:code,months:r.cells.slice(1).map(cell=>cell===""?null:readBudgetCsvAmount(cell,format,r.line))};
    });
  } catch(e) {if(e instanceof BudgetCsvError)throw new MonthlyCsvError(e.code,e.row);throw e;}
}
export function previewMonthlyBudgetCsv(text:string,format:BudgetCsvFormat,accounts:readonly MonthlyImportAccount[]):MonthlyImportPreview[]{
  const byCode=new Map(accounts.map(a=>[a.code,a]));
  return readMonthlyBudgetCsv(text,format).map(r=>{
    const a=byCode.get(r.accountCode);
    if(!a||!(a.type==="REVENUE"||a.type==="EXPENSE"))throw new MonthlyCsvError("annual",r.row);
    if(!a.isActive)throw new MonthlyCsvError("inactive",r.row);
    const annualCents=BigInt(a.annualCents),summary=allocationSummary(annualCents,r.months);
    if(summary.remainingCents<0n)throw new MonthlyCsvError("excess",r.row);
    const before=a.months.map(v=>v===null?null:BigInt(v));
    return {...r,accountId:a.id,nameFr:a.nameFr,nameEn:a.nameEn,type:a.type,annualCents,before,...summary,changedCount:r.months.filter((v,i)=>v!==before[i]).length,removedCount:r.months.filter((v,i)=>v===null&&before[i]!==null).length};
  });
}
export function monthlyImportReview(rows:readonly MonthlyImportPreview[]):MonthlyImportReview[]{return rows.map(r=>({accountId:r.accountId,accountCode:r.accountCode,months:r.months.map(v=>v===null?null:v.toString())}));}
export function monthlyBudgetCsvTemplate(format:BudgetCsvFormat):string{return '\uFEFF'+MONTHLY_CSV_HEADER.join(format==="en"?',':';')+'\r\n';}
