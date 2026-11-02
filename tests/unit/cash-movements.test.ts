import { it,expect } from "vitest";
import { cashTotals,cashMovementsCsv,type CashCsvLabels,type CashMovementsReport } from "@/modules/reports";
it("keeps exact amounts beyond safe integers and reports a gap without adjusting balances",()=>{
 const r=cashTotals([{openingCents:9007199254740993n,incomingCents:100n,outgoingCents:50n,transferInCents:20n,transferOutCents:10n,closingCents:9007199254741052n}]);
 expect(r.netCents).toBe(59n);expect(r.differenceCents).toBe(1n);
 expect(cashTotals([])).toMatchObject({closingCents:0n,differenceCents:0n});
});
it("exports scoped totals, numeric amounts and safe bilingual detail text",()=>{
 const a={id:"one",code:"1000",nameFr:"=Banque",nameEn:"@Bank",isActive:false,openingCents:100n,incomingCents:200n,outgoingCents:0n,transferInCents:0n,transferOutCents:0n,closingCents:300n};
 const report:CashMovementsReport={from:"2026-06-01",to:"2026-06-30",accounts:[a],selectedAccountId:"one",byAccount:[a],totals:cashTotals([a]),lines:[{id:"l",entryId:"e",entryNumber:"J-00001",date:"2026-06-01",accountId:"one",accountCode:"1000",memo:"=2+2",kind:"movement",debitCents:200n,creditCents:0n}],lineCount:1,mixedEntryCount:0,page:1,pageCount:1};
 const labels:CashCsvLabels={account:"Account",total:"Total",date:"Date",entry:"Entry",memo:"Memo",kind:"Kind",debit:"Debit",credit:"Credit",net:"Net",control:"Control",detail:"Detail",mixedCount:"Mixed count",scope:"BANK/CASH",movement:"Movement",transfer:"Transfer",mixed:"Mixed",openingCents:"Opening",incomingCents:"In",outgoingCents:"Out",transferInCents:"Transfer in",transferOutCents:"Transfer out",closingCents:"Closing"};
 expect(cashMovementsCsv(report,"Cash",labels,"fr-CA")).toContain("2026-06-01;J-00001;1000;'=2+2;Movement;2,00;0,00\r\n");
 expect(cashMovementsCsv(report,"Cash",labels,"en")).toContain("Total,1.00,2.00,0.00,0.00,0.00,3.00\r\n");
});
