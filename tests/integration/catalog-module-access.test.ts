import { afterAll,beforeAll,expect,it } from "vitest";
import type pg from "pg";
import {saveItem,getItem,archiveCatalog} from "@/modules/taxes";
import {owner} from "./helpers";
import {seedWorld,W} from "./world";
let db:pg.Client;const actor={userId:W.userOwnerA,companyId:W.companyA},user={...actor,userId:W.userReader};
const basic={code:"BASIC",name:"Catalogue only",description:"",unitPrice:"12.345678",incomeAccountId:"",expenseAccountId:"",defaultTaxCodeId:""};
beforeAll(async()=>{db=await owner();await seedWorld(db);await db.query("UPDATE membership SET role='USER',module_access='{\"catalog\":\"write\",\"accounting\":\"none\",\"taxes\":\"none\"}' WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader]);});
afterAll(async()=>{await db?.end();});
it("lets a catalogue-only writer create and archive basic products without financial rights",async()=>{
 const id=await saveItem(user,basic);expect(await getItem(user,id)).toMatchObject({name:basic.name,unitPrice:"12.345678"});await archiveCatalog(user,"item",id,false);expect((await getItem(user,id))?.isActive).toBe(false);
 await expect(archiveCatalog(user,"taxCode",W.taxCodeStandard,false)).rejects.toThrow();
 await expect(saveItem(user,{...basic,code:"REF",incomeAccountId:W.sales})).rejects.toThrow();
 await expect(saveItem(user,{...basic,code:"TAX",defaultTaxCodeId:W.taxCodeStandard})).rejects.toThrow();
});
it("preserves existing financial defaults while refusing forged changes or removals",async()=>{
 const linked={...basic,code:"LINKED",incomeAccountId:W.sales,expenseAccountId:W.expenses,defaultTaxCodeId:W.taxCodeStandard},id=await saveItem(actor,linked);
 await saveItem(user,{...linked,name:"Updated basic name"},id);expect(await getItem(user,id)).toMatchObject({name:"Updated basic name",incomeAccountId:W.sales,defaultTaxCodeId:W.taxCodeStandard});
 for(const change of [{incomeAccountId:""},{expenseAccountId:W.bankB},{defaultTaxCodeId:""}])await expect(saveItem(user,{...linked,...change},id)).rejects.toThrow();
 await db.query("UPDATE membership SET module_access='{\"catalog\":\"write\",\"accounting\":\"read\",\"taxes\":\"read\"}' WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader]);
 await saveItem(user,{...linked,defaultTaxCodeId:W.taxCodeExempt},id);expect((await getItem(user,id))?.defaultTaxCodeId).toBe(W.taxCodeExempt);
 await expect(saveItem(user,{...linked,incomeAccountId:W.bankB},id)).rejects.toThrow();
 await db.query("UPDATE membership SET module_access='{\"catalog\":\"none\",\"taxes\":\"write\"}' WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader]);await expect(saveItem(user,basic)).rejects.toThrow();
});
