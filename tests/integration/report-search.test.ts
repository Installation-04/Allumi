import { beforeAll,afterAll,it,expect } from "vitest";
import type pg from "pg";
import { searchCompany,SEARCH_REPORTS } from "@/modules/search";
import { owner } from "./helpers";
import { seedWorld,W } from "./world";
const actor={userId:W.userOwnerA,companyId:W.companyA},reader={...actor,userId:W.userReader};let db:pg.Client;
beforeAll(async()=>{db=await owner();await seedWorld(db);});afterAll(async()=>{await db?.end();});
it("finds existing report forms in both languages and by explicit synonyms without invented dates or amounts",async()=>{
 const all=await searchCompany(actor,{type:"REPORT"},"fr-CA");expect(all.rows).toHaveLength(13);expect(all.rows.map(r=>r.id)).toEqual(SEARCH_REPORTS.map(r=>r.id).sort());expect(all.hasMore).toBe(false);
 for(const r of all.rows){expect(r).toMatchObject({kind:"REPORT",status:"AVAILABLE",reference:null,date:null,amountCents:null,href:`/c/${W.companyA}/${r.id}`});}
 for(const q of ["État des résultats","Etat des resultats","income statement","p&l"]){expect((await searchCompany(reader,{type:"REPORT",q},"fr-CA")).rows.map(r=>r.id)).toContain("resultats");}
 expect((await searchCompany(reader,{type:"REPORT",q:"Bilan"},"en")).rows.find(r=>r.id==="bilan")?.name).toBe("Balance sheet");
 expect((await searchCompany(reader,{q:"trial balance"},"en")).rows.map(r=>r.id)).toContain("balance");expect((await searchCompany(reader,{type:"REPORT",q:"bilan/comparer"},"en")).rows.map(r=>r.id)).toEqual(["bilan/comparer"]);
 expect((await searchCompany(reader,{type:"REPORT",q:"%_\\"},"en")).rows).toEqual([]);
});
it("combines report kind/status/text filters and excludes reports from record date and money filters",async()=>{
 expect((await searchCompany(reader,{type:"REPORT",statut:"AVAILABLE",q:"GST"},"en")).rows.map(r=>r.id)).toEqual(["sommaire-taxes","sommaire-taxes/comparer"]);
 for(const params of [{du:"2026-01-01"},{au:"2026-12-31"},{montant:"0"},{montant:"17.23"},{statut:"POSTED"},{q:"2026-01-01"},{page:"2"}])expect((await searchCompany(reader,{type:"REPORT",...params},"en")).rows).toEqual([]);
 expect((await searchCompany(reader,{},"en")).rows).toEqual([]);
});
it("requires the exact module combination for each destination in the same SQL permission snapshot",async()=>{
 const access=async(value:unknown)=>db.query("UPDATE membership SET module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader,JSON.stringify(value)]);
 await access({accounting:"read",sales:"none",contacts:"none",taxes:"none"});const limited=(await searchCompany(reader,{type:"REPORT"},"en")).rows.map(r=>r.id);expect(limited).toHaveLength(8);for(const r of ["age-clients","releves-clients","releves-fournisseurs","sommaire-taxes","sommaire-taxes/comparer"])expect(limited).not.toContain(r);
 await access({accounting:"read",sales:"read",contacts:"none",taxes:"read"});const tax=(await searchCompany(reader,{type:"REPORT"},"en")).rows.map(r=>r.id);expect(tax).toHaveLength(11);expect(tax).toContain("age-clients");expect(tax).toContain("sommaire-taxes/comparer");expect(tax).not.toContain("releves-clients");
 await access({accounting:"none",sales:"read",contacts:"read",taxes:"read"});expect((await searchCompany(reader,{type:"REPORT"},"en")).rows).toEqual([]);
});
it("scopes report links to the active company and refuses revoked/foreign memberships without writes",async()=>{
 const before=(await db.query("SELECT count(*)::int AS n FROM audit_log")).rows[0].n;
 const foreign={userId:W.userOwnerB,companyId:W.companyB};const rows=(await searchCompany(foreign,{type:"REPORT"},"en")).rows;expect(rows).toHaveLength(13);expect(rows.every(r=>r.href.startsWith(`/c/${W.companyB}/`))).toBe(true);await expect(searchCompany({...reader,companyId:W.companyB},{type:"REPORT"},"en")).rejects.toThrow();
 expect((await db.query("SELECT count(*)::int AS n FROM audit_log")).rows[0].n).toBe(before);await db.query("DELETE FROM membership WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader]);await expect(searchCompany(reader,{type:"REPORT"},"en")).rejects.toThrow();
});
