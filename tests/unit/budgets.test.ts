import { it,expect } from "vitest";
import { compareBudget,budgetCsv,budgetInput,targetInput } from "@/modules/budgets/client";
import type { BudgetComparison } from "@/modules/budgets";
const account={accountId:'00000000-0000-7000-8000-000000000001',code:'=COMMAND()',nameFr:'@Nom privé',nameEn:'+Danger',type:'REVENUE' as const,isActive:false,hasActivity:true};
it('keeps exact large amounts and missing targets distinct from zero even for net-zero activity',()=>{
 const r=compareBudget([{...account,targetCents:null,actualCents:0n},{...account,type:'EXPENSE',targetCents:0n,actualCents:99999999999999999999n}]);
 expect(r.rows[0]!.differenceCents).toBeNull();expect(r.revenue.unbudgeted).toBe(1);
 expect(r.expenses).toEqual({targetCents:0n,actualCents:99999999999999999999n,unbudgeted:0});expect(r.rows[1]!.differenceCents).toBe(99999999999999999999n);
});
it('exports localized exact CSV, neutralizes text formulas, and preserves absent targets',()=>{
 const report:BudgetComparison={id:account.accountId,name:'=SUM(1,2)',revision:1,fiscalYearId:account.accountId,from:'2026-01-01',to:'2026-12-31',...compareBudget([{...account,targetCents:100n,actualCents:-10n},{...account,code:'4001',targetCents:null,actualCents:0n}])};
 const t=(key:string)=>key;
 const en=budgetCsv(report,'en',t);expect(en).toContain('"\'=SUM(1,2)"');expect(en).toContain("'=COMMAND(),'+Danger,revenue,1.00,-0.10,-1.10");expect(en).toContain('4001,\'+Danger,revenue,notSet,0.00,');
 const fr=budgetCsv(report,'fr-CA',t);expect(fr).toContain("'=COMMAND();'@Nom privé;revenue;1,00;-0,10;-1,10");expect(fr).toContain('coverage;1');
});
it('validates non-negative bounded annual targets and control-free trimmed scenario names',()=>{
 expect(budgetInput.parse({name:'  Plan 2026  ',fiscalYearId:account.accountId}).name).toBe('Plan 2026');
 for(const name of ['','\t','bad\u0085name','a'.repeat(121)])expect(budgetInput.safeParse({name,fiscalYearId:account.accountId}).success).toBe(false);
 for(const amountCents of [-1n,100000000000001n])expect(targetInput.safeParse({accountId:account.accountId,amountCents,revision:1}).success).toBe(false);
 expect(targetInput.safeParse({accountId:account.accountId,amountCents:100000000000000n,revision:1}).success).toBe(true);
});
