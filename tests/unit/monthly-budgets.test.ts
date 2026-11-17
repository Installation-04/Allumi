import { it,expect } from 'vitest';
import fc from 'fast-check';
import { allocationSummary,splitAnnualTarget,monthlyAllocationInput,monthlyBudgetCsv } from '@/modules/budgets/client';
import type { MonthlyBudget } from '@/modules/budgets';
it('splits any annual cent target exactly with a maximum one-cent gap',()=>{
 fc.assert(fc.property(fc.bigInt({min:0n,max:100000000000000n}),amount=>{const parts=splitAnnualTarget(amount);expect(parts).toHaveLength(12);expect(parts.reduce((s,v)=>s+v,0n)).toBe(amount);expect(parts[0]!-parts[11]!).toBeLessThanOrEqual(1n);expect(parts.every(v=>v>=0n)).toBe(true);}));
 expect(splitAnnualTarget(13n)).toEqual([2n,1n,1n,1n,1n,1n,1n,1n,1n,1n,1n,1n]);
});
it('keeps undefined months distinct from zeros and recognizes complete versus partial allocation',()=>{
 expect(allocationSummary(0n,Array(12).fill(null))).toEqual({allocatedCents:0n,remainingCents:0n,definedCount:0,complete:false});
 expect(allocationSummary(0n,Array(12).fill(0n)).complete).toBe(true);
 expect(allocationSummary(100n,[50n,0n,...Array(10).fill(null)])).toEqual({allocatedCents:50n,remainingCents:50n,definedCount:2,complete:false});
 expect(allocationSummary(100n,[101n,...Array(11).fill(null)]).remainingCents).toBe(-1n);
});
it('requires all twelve distinct period identities and bounded non-negative targets',()=>{
 const targets=Array.from({length:12},(_,i)=>({periodId:`00000000-0000-7000-8000-${String(i).padStart(12,'0')}`,amountCents:null as bigint|null}));
 expect(monthlyAllocationInput.safeParse({revision:1,targets}).success).toBe(true);expect(monthlyAllocationInput.safeParse({revision:1,targets:targets.slice(1)}).success).toBe(false);
 expect(monthlyAllocationInput.safeParse({revision:1,targets:targets.map(()=>targets[0])}).success).toBe(false);
 for(const amountCents of [-1n,100000000000001n])expect(monthlyAllocationInput.safeParse({revision:1,targets:targets.map((t,i)=>i?t:{...t,amountCents})}).success).toBe(false);
});
it('exports exact monthly targets, missing values and safe text in both locales',()=>{
 const period={id:'p',number:1,from:'2026-04-01',to:'2026-04-30'};
 const r:MonthlyBudget={id:'b',name:'=FORMULA',revision:1,from:'2026-04-01',to:'2027-03-31',periods:[period],selected:period,rows:[{accountId:'a',code:'=CMD',nameFr:'@Nom',nameEn:'+Name',type:'REVENUE',isActive:false,annualCents:100n,targetCents:null,actualCents:-1n,hasActivity:true,differenceCents:null,allocation:{allocatedCents:0n,remainingCents:100n,definedCount:0,complete:false}}],revenue:{targetCents:0n,actualCents:-1n,unbudgeted:1},expenses:{targetCents:0n,actualCents:0n,unbudgeted:0}};
 const t=(s:string)=>s,en=monthlyBudgetCsv(r,'en',t),fr=monthlyBudgetCsv(r,'fr-CA',t);expect(en).toContain("'=CMD,'+Name,revenue,notSet,-0.01,,1.00,0.00,1.00,0");expect(fr).toContain("'=CMD;'@Nom;revenue;notSet;-0,01;;1,00;0,00;1,00;0");expect(en).toContain('2026-04-01,2026-04-30');
});
