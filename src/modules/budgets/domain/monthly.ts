import { z } from "zod";
import { MAX_LINE_CENTS } from "@/modules/ledger/client";
export const monthlyAllocationInput=z.object({revision:z.number().int().positive().max(2147483600),targets:z.array(z.object({periodId:z.uuid(),amountCents:z.bigint().min(0n).max(MAX_LINE_CENTS).nullable()})).length(12)}).refine(v=>new Set(v.targets.map(t=>t.periodId)).size===12);
export function allocationSummary(annualCents:bigint,amounts:readonly(bigint|null)[]){
 const allocatedCents=amounts.reduce<bigint>((sum,a)=>sum+(a??0n),0n),definedCount=amounts.filter(a=>a!==null).length;
 return {allocatedCents,remainingCents:annualCents-allocatedCents,definedCount,complete:amounts.length===12&&definedCount===12&&allocatedCents===annualCents};
}
/** Exact equal allocation; the first periods receive any remaining cents. Nothing is saved by this helper. */
export function splitAnnualTarget(annualCents:bigint):bigint[]{
 if(annualCents<0n||annualCents>MAX_LINE_CENTS)throw new RangeError("invalid annual target");
 const base=annualCents/12n,remainder=annualCents%12n;
 return Array.from({length:12},(_,i)=>base+(BigInt(i)<remainder?1n:0n));
}
