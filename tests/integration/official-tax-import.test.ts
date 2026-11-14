import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import type pg from "pg";
import { getOfficialTaxPreview, importOfficialTaxes, getTaxConfiguration, CRA_URL, calculateTaxes, effectiveRate } from "@/modules/taxes";
import cra from "../fixtures/official-tax-cra.json";
import {saveDraft,getDraft,postInvoice,getInvoice} from "@/modules/sales";
import { owner } from "./helpers";
import { seedWorld,W } from "./world";
const actor={userId:W.userOwnerA,companyId:W.companyA},reader={...actor,userId:W.userReader};let db:pg.Client;
const rq=readFileSync(new URL("../fixtures/official-tax-rq.html",import.meta.url),"utf8");let html=rq;
const fetch=vi.fn(async(url:unknown)=>new Response(url===CRA_URL?JSON.stringify(cra):html,{headers:{"content-type":url===CRA_URL?"application/json":"text/html"}}));
const input={province:"QC",date:"2026-01-01",code:"QC-STD",federalPayable:W.gstPayable,federalRecoverable:W.gstReceivable,qstPayable:W.qstPayable,qstRecoverable:W.qstReceivable,confirmed:"yes"};
beforeAll(async()=>{db=await owner();await seedWorld(db);await db.query("INSERT INTO number_sequence(company_id,key,next_value,prefix,padding) VALUES($1,'JOURNAL_ENTRY',1,'J-',5),($1,'INVOICE',1,'F-',5)",[W.companyA]);vi.stubGlobal("fetch",fetch);});afterAll(async()=>{vi.unstubAllGlobals();await db?.end();});
it("creates exact historical taxes and a usable code atomically with source provenance in the audit trail",async()=>{
 const preview=await getOfficialTaxPreview(reader,"QC","2026-01-01");const id=await importOfficialTaxes(actor,{...input,fingerprint:preview.fingerprint});
 const config=await getTaxConfiguration(reader),code=config.codes.find(c=>c.id===id)!;expect(code.components).toHaveLength(2);
 const taxes=code.components.map(c=>config.taxes.find(t=>t.id===c.taxId)!);
 const total=calculateTaxes([{quantity:"1",unitPrice:"100",taxes:taxes.map(t=>({id:t.id,rate:effectiveRate(t.rates,"2026-01-01")}))}],"PER_LINE");expect(total.totalCents).toBe(11498n);
 const event=(await db.query("SELECT actor_user_id,after FROM audit_log WHERE company_id=$1 AND action='tax.official_import' AND entity_id=$2",[W.companyA,id])).rows[0];expect(event.actor_user_id).toBe(W.userOwnerA);expect(event.after.fingerprint).toBe(preview.fingerprint);expect(event.after.sources.map((s:{id:string})=>s.id)).toEqual(["CRA_GST_HST","RQ_QST"]);
 expect(config.taxes.find(t=>t.id===W.gst)?.rates).toHaveLength(1);
 const invoice=await saveDraft(actor,{contactId:W.customer,issueDate:"2026-06-15",dueDate:"2026-06-30",lines:[{description:"Imported tax code",quantity:"1",unitPrice:"100",accountId:W.sales,taxCodeId:id}]});
 await postInvoice(actor,invoice,(await getDraft(actor,invoice))!.revision,"2026-06-15");expect((await getInvoice(actor,invoice))?.totalCents).toBe(11498n);
});
it("refuses readers, foreign accounts and revoked access without leaving partial taxes or codes",async()=>{
 const preview=await getOfficialTaxPreview(reader,"QC","2026-01-01"),n=(await db.query("SELECT count(*)::int AS n FROM tax WHERE company_id=$1",[W.companyA])).rows[0].n;
 await expect(importOfficialTaxes(reader,{...input,code:"READ",fingerprint:preview.fingerprint})).rejects.toThrow();
 await expect(importOfficialTaxes(actor,{...input,code:"FOREIGN",federalPayable:W.bankB,fingerprint:preview.fingerprint})).rejects.toThrow();
 await expect(importOfficialTaxes(actor,{...input,code:"ROLLBACK",qstPayable:W.gstReceivable,fingerprint:preview.fingerprint})).rejects.toThrow();
 expect((await db.query("SELECT count(*)::int AS n FROM tax WHERE company_id=$1",[W.companyA])).rows[0].n).toBe(n);
 fetch.mockClear();await expect(getOfficialTaxPreview({...actor,companyId:W.companyB},"QC","2026-01-01")).rejects.toThrow();expect(fetch).not.toHaveBeenCalled();
 await db.query("UPDATE membership SET module_access='{\"taxes\":\"none\"}' WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader]);
 await expect(getOfficialTaxPreview(reader,"QC","2026-01-01")).rejects.toThrow();expect(fetch).not.toHaveBeenCalled();
});
it("rejects stale previews, missing confirmation and duplicate concurrent imports",async()=>{
 const preview=await getOfficialTaxPreview(actor,"QC","2026-01-01");html=rq.replace("9,975","10");await expect(importOfficialTaxes(actor,{...input,code:"STALE",fingerprint:preview.fingerprint})).rejects.toMatchObject({key:"officialTaxes.changed"});html=rq;
 await expect(importOfficialTaxes(actor,{...input,code:"NO",confirmed:"",fingerprint:preview.fingerprint})).rejects.toThrow();
 const results=await Promise.allSettled([1,2].map(()=>importOfficialTaxes(actor,{...input,code:"RETRY",fingerprint:preview.fingerprint})));expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
 expect((await db.query("SELECT count(*)::int AS n FROM tax WHERE company_id=$1 AND code LIKE 'RETRY-%'",[W.companyA])).rows[0].n).toBe(2);
 const ns=await getOfficialTaxPreview(actor,"NS","2025-03-31");const id=await importOfficialTaxes(actor,{...input,province:"NS",date:"2025-03-31",code:"NS-STD",fingerprint:ns.fingerprint});const config=await getTaxConfiguration(actor),c=config.codes.find(c=>c.id===id)!,t=config.taxes.find(t=>t.id===c.components[0]!.taxId)!;
 expect(c.components).toHaveLength(1);expect(effectiveRate(t.rates,"2025-03-31")).toBe("0.15");expect(effectiveRate(t.rates,"2025-04-01")).toBe("0.14");
});

it("honors modular tax writers and rechecks rights after the external fetch",async()=>{
 await db.query("UPDATE membership SET role='USER',module_access='{\"taxes\":\"write\",\"accounting\":\"read\",\"sales\":\"none\",\"contacts\":\"none\"}' WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader]);
 const preview=await getOfficialTaxPreview(reader,"QC","2026-01-01");await expect(importOfficialTaxes(reader,{...input,code:"MODULAR",fingerprint:preview.fingerprint})).resolves.toBeTypeOf("string");
 fetch.mockImplementationOnce(async()=>{await db.query("UPDATE membership SET module_access='{\"taxes\":\"none\"}' WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader]);return new Response(JSON.stringify(cra),{headers:{"content-type":"application/json"}});});
 await expect(getOfficialTaxPreview(reader,"NS","2026-01-01")).rejects.toThrow();
});
