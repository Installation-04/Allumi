import { it,expect } from "vitest";
import fc from "fast-check";
import { readBudgetCsv,decodeBudgetCsv,previewBudgetCsv,budgetImportReview,budgetCsvTemplate,BudgetCsvError,MAX_BUDGET_CSV_BYTES,type ImportAccount } from "@/modules/budgets/client";
const account:ImportAccount={id:'00000000-0000-7000-8000-000000000001',code:'0040',nameFr:'Revenus',nameEn:'Revenue',type:'REVENUE',isActive:true,stateToken:'a'.repeat(64)};
function error(fn:()=>unknown){try{fn();throw new Error('expected rejection');}catch(e){expect(e).toBeInstanceOf(BudgetCsvError);return e as BudgetCsvError;}}
it('reads exact English/French values, leading-zero account codes, quoted cells, BOM and line endings',()=>{
 expect(readBudgetCsv('\uFEFF"account_code","annual_target"\r\n"0040","1000000000000.00"\r\n5000,0\r\n','en')).toEqual([{row:2,accountCode:'0040',amountCents:100000000000000n},{row:3,accountCode:'5000',amountCents:0n}]);
 expect(readBudgetCsv('account_code;annual_target\n\n 0040 ; 12,3 \r5000;0,00','fr-CA')).toEqual([{row:3,accountCode:'0040',amountCents:1230n},{row:4,accountCode:'5000',amountCents:0n}]);
});
it('round-trips cent amounts without floats in both formats',()=>{
 fc.assert(fc.property(fc.bigInt({min:0n,max:100000000000000n}),n=>{
  const amount=`${n/100n}.${(n%100n).toString().padStart(2,'0')}`;
  expect(readBudgetCsv(`account_code,annual_target\n0040,${amount}`,'en')[0]?.amountCents).toBe(n);
  expect(readBudgetCsv(`account_code;annual_target\n0040;${amount.replace('.',',')}`,'fr-CA')[0]?.amountCents).toBe(n);
 }));
});
it('refuses ambiguous, negative, grouped, sub-cent, exponential and out-of-range amounts',()=>{
 for(const amount of ['-1','-0','+1','1e3','1.001','1,23','$1.00','1 000.00','1000000000000.01','NaN',''])expect(error(()=>readBudgetCsv(`account_code,annual_target\n0040,"${amount}"`,'en')).code).toBe('amount');
 expect(error(()=>readBudgetCsv('account_code;annual_target\n0040;1.25','fr-CA')).code).toBe('amount');
});
it('refuses malformed quotes, columns, headers, duplicate codes and formulas',()=>{
 for(const text of ['account_code,annual_target\n"0040"junk,1','account_code,annual_target\n0040,"1','account_code,annual_target\n00"40,1'])expect(error(()=>readBudgetCsv(text,'en')).code).toBe('syntax');
 expect(error(()=>readBudgetCsv('account_code,annual_target\n0040,1,2','en')).code).toBe('columns');
 expect(error(()=>readBudgetCsv('annual_target,account_code\n1,0040','en')).code).toBe('header');
 expect(error(()=>readBudgetCsv('account_code,annual_target\n0040,1\n" 0040 ",2','en')).code).toBe('duplicate');
 expect(error(()=>readBudgetCsv('account_code,annual_target\n=CMD(),1','en')).code).toBe('code');
 expect(error(()=>readBudgetCsv(budgetCsvTemplate('en'),'en')).code).toBe('empty');
});
it('enforces strict UTF-8, 256 KiB and exactly 1,000 targets without truncating',()=>{
 expect(decodeBudgetCsv(new TextEncoder().encode('\uFEFFaccount_code,annual_target'))).toBe('account_code,annual_target');
 expect(error(()=>decodeBudgetCsv(new Uint8Array([255,254,0,1]))).code).toBe('encoding');
 expect(error(()=>decodeBudgetCsv(new Uint8Array(MAX_BUDGET_CSV_BYTES+1))).code).toBe('tooLarge');
 expect(error(()=>readBudgetCsv('é'.repeat(MAX_BUDGET_CSV_BYTES/2+1),'en')).code).toBe('tooLarge');
 const rows=Array.from({length:1000},(_,i)=>`A${i},0`).join('\n'),file='account_code,annual_target\n'+rows;
 expect(readBudgetCsv(file,'en')).toHaveLength(1000);expect(error(()=>readBudgetCsv(file+'\nLAST,1','en')).code).toBe('tooMany');
});
it('resolves local active revenue/expense accounts and produces a complete serializable review',()=>{
 const rows=previewBudgetCsv('account_code,annual_target\n0040,0','en',[account]);
 expect(rows[0]).toMatchObject({accountId:account.id,nameEn:'Revenue',amountCents:0n});expect(budgetImportReview(rows)).toEqual([{accountId:account.id,accountCode:'0040',amountCents:'0',stateToken:account.stateToken}]);
 expect(error(()=>previewBudgetCsv('account_code,annual_target\n0040,1','en',[])).code).toBe('account');
 expect(error(()=>previewBudgetCsv('account_code,annual_target\n0040,1','en',[{...account,type:'ASSET'}])).code).toBe('account');
 expect(error(()=>previewBudgetCsv('account_code,annual_target\n0040,1','en',[{...account,isActive:false}])).code).toBe('inactive');
});
