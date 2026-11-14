import { expect, it } from "vitest";
import { parseSearchFilters, hasSearchCriteria } from "@/modules/search";
it("parses exact Canadian amounts without floating point and recognizes zero", () => {
  expect(parseSearchFilters({ montant: "1,234.56", q: "$1,234.56" }, "en")).toMatchObject({amountCents:123456n,queryCents:123456n});
  expect(parseSearchFilters({ montant: "0", q: "0,01" }, "fr-CA")).toMatchObject({amountCents:0n,queryCents:1n});
  expect(hasSearchCriteria(parseSearchFilters({},"en"))).toBe(false);
  expect(hasSearchCriteria(parseSearchFilters({montant:"0"},"en"))).toBe(true);
});
it("rejects repeated or invalid filters, reversed dates and excessive pagination", () => {
  for (const params of [{q:["a","b"]},{type:["BILL","INVOICE"]},{type:"BANK"},{statut:"paid"},{du:"2026-02-30"},{du:"2026-06-02",au:"2026-06-01"},{montant:"1.001"},{montant:"-1"},{montant:"1".repeat(200)},{page:"101"},{page:"0"},{page:"1e1"},{q:"a\u0000b"},{q:"x".repeat(121)}]) expect(()=>parseSearchFilters(params,"en")).toThrow(RangeError);
  expect(parseSearchFilters({du:"2024-02-29",page:"100",type:"BILL",statut:"VOID"},"en")).toMatchObject({from:"2024-02-29",page:100,kind:"BILL",status:"VOID"});
});

it("keeps the same exact amount when switching between French and English",()=>{
  for(const value of ["1 234,56 $","$1,234.56","1234.56","1234,56"]){
    for(const locale of ["fr-CA","en"] as const)expect(parseSearchFilters({montant:value,q:value},locale)).toMatchObject({amountCents:123456n,queryCents:123456n});
  }
});
