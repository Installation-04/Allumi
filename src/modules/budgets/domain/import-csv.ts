import { ACCOUNT_CODE,MAX_LINE_CENTS,type AccountType } from "@/modules/ledger/client";
import { MAX_BUDGET_ACCOUNTS } from "./budget";

export const MAX_BUDGET_CSV_BYTES=256*1024;
export const MAX_IMPORT_CHART_ACCOUNTS=5000;
export type BudgetCsvFormat="en"|"fr-CA";
export type BudgetCsvIssue="encoding"|"tooLarge"|"syntax"|"header"|"empty"|"tooMany"|"columns"|"code"|"amount"|"duplicate"|"account"|"inactive";
export class BudgetCsvError extends Error {
  constructor(readonly code:BudgetCsvIssue,readonly row=0){super(code);this.name="BudgetCsvError";}
}
export type CsvTarget={row:number;accountCode:string;amountCents:bigint};
export type ImportAccount={id:string;code:string;nameFr:string;nameEn:string;type:AccountType;isActive:boolean;stateToken:string};
export type ImportPreviewTarget=CsvTarget&{accountId:string;nameFr:string;nameEn:string;type:"REVENUE"|"EXPENSE";stateToken:string};
export type ImportReview={accountId:string;accountCode:string;amountCents:string;stateToken:string};

export function decodeBudgetCsv(bytes:Uint8Array):string {
  if(bytes.byteLength>MAX_BUDGET_CSV_BYTES)throw new BudgetCsvError("tooLarge");
  try{return new TextDecoder("utf-8",{fatal:true}).decode(bytes);}catch{throw new BudgetCsvError("encoding");}
}
/** Bounded RFC 4180 subset shared by the annual and monthly import grids. */
export function readBudgetCsvRecords(input:string,format:BudgetCsvFormat,limits={columns:2,rows:MAX_BUDGET_ACCOUNTS}):{line:number;cells:string[]}[]{
  if(new TextEncoder().encode(input).byteLength>MAX_BUDGET_CSV_BYTES)throw new BudgetCsvError("tooLarge");
  const text=input.replace(/^\uFEFF/u,""),delimiter=format==="en"?",":";";
  const records:{line:number;cells:string[]}[]=[];
  let cells:string[]=[],cell="",mode:"start"|"plain"|"quoted"|"closed"="start",line=1,start=1;
  const endCell=()=>{cells.push(cell.trim());cell="";mode="start";if(cells.length>limits.columns)throw new BudgetCsvError("columns",start);};
  const endRow=()=>{endCell();if(cells.some(c=>c!=="")){records.push({line:start,cells});if(records.length>limits.rows+1)throw new BudgetCsvError("tooMany",start);}cells=[];};
  for(let i=0;i<text.length;i++){
    const c=text[i]!;
    if(mode==="quoted"){
      if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else mode="closed";}
      else{cell+=c;if(c==='\n'||(c==='\r'&&text[i+1]!=='\n'))line++;}
    }else if(c===delimiter){endCell();}
    else if(c==='\r'||c==='\n'){if(c==='\r'&&text[i+1]==='\n')i++;endRow();line++;start=line;}
    else if(mode==="closed")throw new BudgetCsvError("syntax",start);
    else if(c==='"'){if(mode!=="start")throw new BudgetCsvError("syntax",start);mode="quoted";}
    else{cell+=c;mode="plain";}
    if(cell.length>128)throw new BudgetCsvError("syntax",start);
  }
  if(mode==="quoted")throw new BudgetCsvError("syntax",start);
  if(cell!==""||cells.length||mode==="closed")endRow();
  return records;
}
export function readBudgetCsv(input:string,format:BudgetCsvFormat):CsvTarget[]{
  const records=readBudgetCsvRecords(input,format);
  const header=records.shift();
  if(!header||header.cells.length!==2||header.cells[0]!=="account_code"||header.cells[1]!=="annual_target")throw new BudgetCsvError("header",header?.line??1);
  if(!records.length)throw new BudgetCsvError("empty");
  const codes=new Set<string>();
  return records.map(r=>{
    if(r.cells.length!==2)throw new BudgetCsvError("columns",r.line);
    const [code,amount]=r.cells as [string,string];
    if(!ACCOUNT_CODE.test(code))throw new BudgetCsvError("code",r.line);
    if(codes.has(code))throw new BudgetCsvError("duplicate",r.line);codes.add(code);
    const cents=readBudgetCsvAmount(amount,format,r.line);
    return {row:r.line,accountCode:code,amountCents:cents};
  });
}
/** Strict non-negative decimal input, without grouping, currencies, exponents or rounding. */
export function readBudgetCsvAmount(amount:string,format:BudgetCsvFormat,row:number):bigint {
  const pattern=format==="en"?/^\d+(?:\.\d{1,2})?$/:/^\d+(?:,\d{1,2})?$/;
  if(!pattern.test(amount))throw new BudgetCsvError("amount",row);
  const [whole,fraction=""]=amount.split(format==="en"?".":",");
  const cents=BigInt(whole!)*100n+BigInt(fraction.padEnd(2,"0"));
  if(cents>MAX_LINE_CENTS)throw new BudgetCsvError("amount",row);
  return cents;
}
export function previewBudgetCsv(text:string,format:BudgetCsvFormat,accounts:readonly ImportAccount[]):ImportPreviewTarget[]{
  const byCode=new Map(accounts.map(a=>[a.code,a]));
  return readBudgetCsv(text,format).map(r=>{
    const a=byCode.get(r.accountCode);
    if(!a||!(a.type==="REVENUE"||a.type==="EXPENSE"))throw new BudgetCsvError("account",r.row);
    if(!a.isActive)throw new BudgetCsvError("inactive",r.row);
    return {...r,accountId:a.id,nameFr:a.nameFr,nameEn:a.nameEn,type:a.type,stateToken:a.stateToken};
  });
}
export function budgetImportReview(rows:readonly ImportPreviewTarget[]):ImportReview[]{
  return rows.map(r=>({accountId:r.accountId,accountCode:r.accountCode,amountCents:r.amountCents.toString(),stateToken:r.stateToken}));
}
export function budgetCsvTemplate(format:BudgetCsvFormat):string{return `\uFEFFaccount_code${format==="en"?",":";"}annual_target\r\n`;}
