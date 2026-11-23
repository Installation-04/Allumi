import { it,expect } from "vitest";
import fc from "fast-check";
import { MonthlyCsvError,readMonthlyBudgetCsv,previewMonthlyBudgetCsv,monthlyImportReview,monthlyBudgetCsvTemplate,MONTHLY_CSV_HEADER,MAX_MONTHLY_IMPORT_ACCOUNTS,type MonthlyImportAccount } from "@/modules/budgets/client";
const account:MonthlyImportAccount={id:'00000000-0000-7000-8000-000000000001',code:'0040',nameFr:'Ventes',nameEn:'Sales',type:'REVENUE',isActive:true,annualCents:'100000000000000',months:Array<string|null>(12).fill(null)};
const file=(values:string[],format:'en'|'fr-CA'='en')=>MONTHLY_CSV_HEADER.join(format==='en'?',':';')+'\r\n'+['0040',...values].join(format==='en'?',':';');
function issue(fn:()=>unknown){try{fn();throw new Error('expected refusal');}catch(e){expect(e).toBeInstanceOf(MonthlyCsvError);return e as MonthlyCsvError;}}
it('reads all twelve fiscal columns, exact cents, explicit zero and missing amounts in both formats',()=>{
 const en=file(['1000000000000.00','0',...Array<string>(10).fill('')]);
 expect(readMonthlyBudgetCsv('\uFEFF'+en,'en')[0]).toEqual({row:2,accountCode:'0040',months:[100000000000000n,0n,...Array<null>(10).fill(null)]});
 expect(readMonthlyBudgetCsv(file(['12,34','0,00',...Array<string>(10).fill('')],'fr-CA'),'fr-CA')[0]?.months).toEqual([1234n,0n,...Array<null>(10).fill(null)]);
});
it('preserves every nullable cent amount through parsing and the serializable confirmation review',()=>{
 fc.assert(fc.property(fc.array(fc.option(fc.bigInt({min:0n,max:10000000000n}),{nil:null}),{minLength:12,maxLength:12}),months=>{
  const text=file(months.map(v=>v===null?'':`${v/100n}.${(v%100n).toString().padStart(2,'0')}`));
  expect(readMonthlyBudgetCsv(text,'en')[0]?.months).toEqual(months);
  const rows=previewMonthlyBudgetCsv(text,'en',[account]);expect(monthlyImportReview(rows)[0]?.months).toEqual(months.map(v=>v===null?null:v.toString()));
 }));
});
it('reviews removals separately from zero and preserves incomplete allocations',()=>{
 const rows=previewMonthlyBudgetCsv(file(['0',...Array<string>(11).fill('')]),'en',[{...account,annualCents:'100',months:['50','0',...Array<string|null>(10).fill(null)]}]);
 expect(rows[0]).toMatchObject({annualCents:100n,allocatedCents:0n,remainingCents:100n,definedCount:1,changedCount:2,removedCount:1,before:[50n,0n,...Array<null>(10).fill(null)]});
 expect(previewMonthlyBudgetCsv(file(Array<string>(12).fill('')),'en',[account])[0]).toMatchObject({definedCount:0,allocatedCents:0n,removedCount:0});
});
it('refuses missing annual targets, inactive accounts and totals above the annual ceiling',()=>{
 const text=file(['1',...Array<string>(11).fill('')]);
 expect(issue(()=>previewMonthlyBudgetCsv(text,'en',[])).code).toBe('annual');
 expect(issue(()=>previewMonthlyBudgetCsv(text,'en',[{...account,isActive:false}])).code).toBe('inactive');
 expect(issue(()=>previewMonthlyBudgetCsv(text,'en',[{...account,annualCents:'99'}])).code).toBe('excess');
 expect(previewMonthlyBudgetCsv(file(['0',...Array<string>(11).fill('')]),'en',[{...account,annualCents:'0'}])[0]?.definedCount).toBe(1);
});
it('requires the ordered thirteen-column header and rejects malformed rows, quotes, duplicate accounts and formulas',()=>{
 const text=file(Array<string>(12).fill('0'));
 expect(issue(()=>readMonthlyBudgetCsv(text.replace('period_1,period_2,','period_2,period_1,'),'en')).code).toBe('header');
 expect(issue(()=>readMonthlyBudgetCsv(file(Array<string>(11).fill('0')),'en')).code).toBe('columns');
 expect(issue(()=>readMonthlyBudgetCsv(file(Array<string>(13).fill('0')),'en')).code).toBe('columns');
 expect(issue(()=>readMonthlyBudgetCsv(text+'\n'+['0040',...Array<string>(12).fill('')].join(','),'en')).code).toBe('duplicate');
 expect(issue(()=>readMonthlyBudgetCsv(text.replace('\r\n0040,','\r\n=CMD(),'),'en')).code).toBe('code');
 expect(issue(()=>readMonthlyBudgetCsv(text.replace('\r\n0040,','\r\n"0040"junk,'),'en')).code).toBe('syntax');
});
it('refuses currencies, negative/grouped/sub-cent/exponential amounts without rounding',()=>{
 for(const v of ['-1','-0','+1','1.001','1e3','$1','NaN','1 000','1000000000000.01','=1+1'])expect(issue(()=>readMonthlyBudgetCsv(file([v,...Array<string>(11).fill('')]),'en')).code).toBe('amount');
 expect(issue(()=>readMonthlyBudgetCsv(file(['1.25',...Array<string>(11).fill('')],'fr-CA'),'fr-CA')).code).toBe('amount');
});
it('handles quoted fields and mixed line endings with useful physical row numbers',()=>{
 const text=MONTHLY_CSV_HEADER.map(v=>`"${v}"`).join(',')+'\n\n"0040",'+['"1.01"',...Array<string>(11).fill('""')].join(',')+'\r';
 expect(readMonthlyBudgetCsv(text,'en')[0]).toMatchObject({row:3,accountCode:'0040',months:[101n,...Array<null>(11).fill(null)]});
});
it('accepts exactly 250 accounts and refuses a 251st or oversized UTF-8 file without truncation',()=>{
 const rows=Array.from({length:MAX_MONTHLY_IMPORT_ACCOUNTS},(_,i)=>['A'+i,...Array<string>(12).fill('0')].join(','));
 const text=MONTHLY_CSV_HEADER.join(',')+'\n'+rows.join('\n');expect(readMonthlyBudgetCsv(text,'en')).toHaveLength(250);
 expect(issue(()=>readMonthlyBudgetCsv(text+'\nLAST'+',0'.repeat(12),'en')).code).toBe('tooMany');
 expect(issue(()=>readMonthlyBudgetCsv('é'.repeat(131073),'en')).code).toBe('tooLarge');
});
it('produces empty UTF-8 templates with BOM, CRLF and the exact fiscal columns',()=>{
 for(const format of ['en','fr-CA'] as const){const template=monthlyBudgetCsvTemplate(format);expect(template).toBe('\uFEFF'+MONTHLY_CSV_HEADER.join(format==='en'?',':';')+'\r\n');expect(issue(()=>readMonthlyBudgetCsv(template,format)).code).toBe('empty');}
});
