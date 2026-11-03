import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyBankRule, listBankRules, previewBankRule, saveBankRule, setBankRuleEnabled, suggestedBankRules, type BankRuleInput } from "@/modules/banking";
import { withCompany } from "@/platform/tenant";
import { owner } from "./helpers";
import { seedWorld, W } from "./world";
const actor={userId:W.userOwnerA,companyId:W.companyA};
const reader={...actor,userId:W.userReader};
const other={userId:W.userOwnerB,companyId:W.companyB};
const input: BankRuleInput={name:"Abonnement cloud",enabled:true,priority:10,field:"DESCRIPTION",text:"Fournisseur cloud",direction:"OUT",sourceAccountId:W.bank,targetAccountId:W.expenses,minCents:1000n,maxCents:5000n};
let db:pg.Client;
beforeAll(async()=>{db=await owner();await seedWorld(db);await db.query("INSERT INTO number_sequence(company_id,key,next_value,prefix,padding) VALUES ($1,'JOURNAL_ENTRY',1,'J-',5)",[W.companyA]);});
afterAll(async()=>{await db?.end();});
async function line(changes: {amount?:bigint;currency?:string;description?:string}={}) {
 const id=randomUUID();await db.query("INSERT INTO bank_transaction(id,company_id,account_id,txn_date,amount_cents,description,dedupe_key,currency,updated_at) VALUES($1::uuid,$2,$3,'2026-01-15',$4,$5,$1::text,$6,now())",[id,W.companyA,W.bank,String(changes.amount??-2000n),changes.description??"Fournisseur cloud janvier",changes.currency??"CAD"]);return id;
}
describe("company bank rules",()=>{
 it("previews, suggests and atomically posts a balanced matched entry with rule audit",async()=>{
  const rule=await saveBankRule(actor,input);const transactionId=await line();
  expect((await previewBankRule(actor,rule.id)).matches.some(t=>t.id===transactionId)).toBe(true);
  expect((await suggestedBankRules(actor,transactionId)).map(r=>r.id)).toContain(rule.id);
  const before=(await db.query("SELECT count(*)::int n FROM journal_entry")).rows[0].n;
  expect((await db.query("SELECT status FROM bank_transaction WHERE id=$1",[transactionId])).rows[0].status).toBe("UNMATCHED");
  const result=await applyBankRule(actor,{ruleId:rule.id,revision:rule.revision,transactionId});
  expect((await db.query("SELECT status FROM bank_transaction WHERE id=$1",[transactionId])).rows[0].status).toBe("MATCHED");
  expect((await db.query("SELECT sum(debit_cents-credit_cents)::text total FROM journal_line WHERE entry_id=$1",[result.entryId])).rows[0].total).toBe("0");
  expect((await db.query("SELECT after FROM audit_log WHERE action='bank_rule.apply' AND entity_id=$1",[transactionId])).rows[0].after).toMatchObject({ruleId:rule.id,revision:1,entryId:result.entryId});
  await expect(applyBankRule(actor,{ruleId:rule.id,revision:rule.revision,transactionId})).rejects.toMatchObject({key:"bankRules.stale"});
  expect((await db.query("SELECT count(*)::int n FROM journal_entry")).rows[0].n).toBe(before+1);
 });
 it("refuses stale changes, disabled rules and transactions that do not meet conditions",async()=>{
  const rule=await saveBankRule(actor,input);const transactionId=await line();
  const changed=await saveBankRule(actor,{...input,text:"Autre"},{id:rule.id,revision:1});
  expect(changed.revision).toBe(2);
  await expect(saveBankRule(actor,input,{id:rule.id,revision:1})).rejects.toMatchObject({key:"bankRules.stale"});
  await expect(applyBankRule(actor,{ruleId:rule.id,revision:1,transactionId})).rejects.toMatchObject({key:"bankRules.stale"});
  await expect(applyBankRule(actor,{ruleId:rule.id,revision:2,transactionId})).rejects.toMatchObject({key:"bankRules.stale"});
  await setBankRuleEnabled(actor,rule.id,2,false);
  expect((await previewBankRule(actor,rule.id)).matches).toEqual([]);
 });
 it("enforces tenant isolation, modular read-only access and account eligibility",async()=>{
  const rule=await saveBankRule(actor,input);const transactionId=await line();
  expect(await listBankRules(other)).toEqual([]);
  await expect(previewBankRule(other,rule.id)).rejects.toMatchObject({key:"bankRules.stale"});
  await expect(saveBankRule(reader,input)).rejects.toMatchObject({key:"forbidden"});
  expect((await listBankRules(reader)).length).toBeGreaterThan(0);
  await expect(applyBankRule(reader,{ruleId:rule.id,revision:1,transactionId})).rejects.toMatchObject({key:"forbidden"});
  for(const targetAccountId of [W.bankB,W.receivable,W.gstPayable]) await expect(saveBankRule(actor,{...input,targetAccountId})).rejects.toMatchObject({key:"bankRules.accounts"});
  await expect(withCompany(reader,tx=>tx.bankRule.create({data:{companyId:actor.companyId,...input}}))).rejects.toThrow();
 });
 it("serializes competing confirmations and rule edits",async()=>{
  const rule=await saveBankRule(actor,input);const transactionId=await line();
  const results=await Promise.allSettled([applyBankRule(actor,{ruleId:rule.id,revision:1,transactionId}),applyBankRule(actor,{ruleId:rule.id,revision:1,transactionId})]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  expect((await db.query("SELECT count(*)::int n FROM journal_entry WHERE source_id=$1",[transactionId])).rows[0].n).toBe(1);
  const edits=await Promise.allSettled([saveBankRule(actor,{...input,name:"A"},{id:rule.id,revision:1}),saveBankRule(actor,{...input,name:"B"},{id:rule.id,revision:1})]);
  expect(edits.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 });
 it("refuses archived accounts at confirmation and allows pausing the obsolete rule",async()=>{
  const account=randomUUID();await db.query("INSERT INTO account(id,company_id,code,name_fr,name_en,type,subtype,updated_at) VALUES($1,$2,'5999','Cloud','Cloud','EXPENSE','OPERATING_EXPENSE',now())",[account,W.companyA]);
  const rule=await saveBankRule(actor,{...input,targetAccountId:account});const transactionId=await line();
  await db.query("UPDATE account SET is_active=false WHERE id=$1",[account]);
  expect((await suggestedBankRules(actor,transactionId)).some(r=>r.id===rule.id)).toBe(false);
  expect((await previewBankRule(actor,rule.id)).available).toBe(false);
  await expect(applyBankRule(actor,{ruleId:rule.id,revision:1,transactionId})).rejects.toMatchObject({key:"bankRules.accounts"});
  await setBankRuleEnabled(actor,rule.id,1,false);
 });
 it("checks module denial in both the service and row policies",async()=>{
  await db.query("UPDATE membership SET module_access='{\"accounting\":\"none\"}'::jsonb WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader]);
  try {
   await expect(listBankRules(reader)).rejects.toMatchObject({key:"forbidden"});
   expect(await withCompany(reader,tx=>tx.bankRule.findMany({where:{companyId:W.companyA}}))).toEqual([]);
  } finally {await db.query("UPDATE membership SET module_access='{}' WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader]);}
 });
 it("bounds preview scans and keeps conditions exact at the scan boundary",async()=>{
  const rule=await saveBankRule(actor,{...input,text:"Preview bounded"});
  await db.query("INSERT INTO bank_transaction(id,company_id,account_id,txn_date,amount_cents,description,dedupe_key,currency,updated_at) SELECT gen_random_uuid(),$1::uuid,$2::uuid,'2026-01-20',-2000,'Preview bounded', 'preview-'||i,'CAD',now() FROM generate_series(1,501) i",[W.companyA,W.bank]);
  const preview=await previewBankRule(actor,rule.id);
  expect(preview.limited).toBe(true);expect(preview.scanned).toBe(500);expect(preview.matches).toHaveLength(500);
 });
 it("enforces the company rule cap even for direct writes",async()=>{
  const count=(await db.query("SELECT count(*)::int n FROM bank_rule WHERE company_id=$1",[W.companyA])).rows[0].n as number;
  await db.query("INSERT INTO bank_rule(id,company_id,name,enabled,field,text,direction,target_account_id,updated_at) SELECT gen_random_uuid(),$1::uuid,'Cap '||i,false,'DESCRIPTION','cap','OUT',$2::uuid,now() FROM generate_series(1,$3::int) i",[W.companyA,W.expenses,200-count]);
  await expect(saveBankRule(actor,input)).rejects.toMatchObject({key:"bankRules.limit"});
  await expect(withCompany(actor,tx=>tx.bankRule.create({data:{companyId:actor.companyId,...input}}))).rejects.toThrow();
  expect(await listBankRules(actor)).toHaveLength(200);
 });

});
