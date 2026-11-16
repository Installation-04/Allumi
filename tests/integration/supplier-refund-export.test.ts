import { afterAll,beforeAll,expect,it } from "vitest";
import type pg from "pg";
import { exportSupplierRefunds,listSupplierRefunds,recordSupplierRefund,voidSupplierRefund,recordDisbursement } from "@/modules/payments";
import { saveDraft,getDraft,getBill,postBill,saveCreditDraft,getCreditDraft,postCreditNote } from "@/modules/purchases";
import { csvFormatFor,toCsv } from "@/modules/reports";
import { getContact } from "@/modules/contacts";
import { owner } from "./helpers";
import { seedWorld,W } from "./world";
const actor={userId:W.userOwnerA,companyId:W.companyA},reader={...actor,userId:W.userReader},other={userId:W.userOwnerB,companyId:W.companyB};
let db:pg.Client;const payments:{id:string;number:string}[]=[];
beforeAll(async()=>{
 db=await owner();await seedWorld(db);await db.query("UPDATE contact SET display_name=$2 WHERE id=$1",[W.supplier,'=Supplier%_\\"Nord']);
 await db.query("INSERT INTO number_sequence(company_id,key,next_value,prefix,padding) VALUES($1,'JOURNAL_ENTRY',1,'J-',5),($1,'PURCHASE_DOCUMENT',1,'A-',5),($1,'PAYMENT_SENT',1,'D-',5),($1,'PAYMENT_RECEIVED',1,'E-',5)",[W.companyA]);
 const bill=await saveDraft(actor,{contactId:W.supplier,documentDate:"2026-06-01",dueDate:"2026-07-01",lines:[{description:"Supplies",quantity:"1",unitPrice:"100",accountId:W.expenses,taxCodeId:W.taxCodeStandard}]});await postBill(actor,bill,(await getDraft(actor,bill))!.revision,"2026-06-01");
 await recordDisbursement(actor,{billId:bill,amountCents:"11498",expectedOpenCents:"11498",date:"2026-06-02",accountId:W.bank,method:"EFT"});
 const document=(await getBill(actor,bill))!,credit=await saveCreditDraft(actor,bill,{documentDate:"2026-06-03",memo:"PRIVATE-CREDIT",lines:[{lineId:document.lines[0]!.id,amount:"100"}]});await postCreditNote(actor,credit,(await getCreditDraft(actor,credit))!.revision,"2026-06-03",{applicationMode:"UNAPPLIED"});
 for(let i=0;i<27;i++)payments.push(await recordSupplierRefund(actor,{supplierCreditId:credit,amountCents:"1",expectedOpenCents:String(11498-i),date:i===0?"2026-06-04":"2026-06-05",accountId:W.bank,method:"EFT",reference:i===0?'=HYPERLINK("test")':`GROUP-${i}`,memo:"PRIVATE-DO-NOT-EXPORT"}));
 await voidSupplierRefund(actor,payments[0]!.id,{date:"2026-06-06",reason:"PRIVATE-VOID-REASON"});
});
afterAll(async()=>{await db?.end();});

it("exports all filtered pages in list order with exact original amounts and current statuses",async()=>{
 const page1=await listSupplierRefunds(reader,1,{q:"%_\\"}),page2=await listSupplierRefunds(reader,2,{q:"%_\\"});expect(page1.refunds).toHaveLength(25);expect(page2.refunds).toHaveLength(2);
 const before=(await db.query("SELECT count(*)::int AS n FROM journal_entry")).rows[0].n;
 const rows=await exportSupplierRefunds(reader,{q:"%_\\"});expect(rows).toHaveLength(27);expect(rows.map(row=>row.number)).toEqual([...page1.refunds,...page2.refunds].map(row=>row.number));expect(rows.every(row=>row.amountCents===1n)).toBe(true);expect(rows.filter(row=>row.status==="VOID")).toHaveLength(1);
 expect(rows.every(row=>Object.keys(row).sort().join(',')==="amountCents,date,method,number,reference,status,supplier")).toBe(true);
 const cells=rows.map(row=>[row.number,row.supplier,row.amountCents,row.reference??""]);
 const en=toCsv(cells,csvFormatFor("en")),fr=toCsv(cells,csvFormatFor("fr-CA"));expect(en).toContain("0.01");expect(fr).toContain("0,01");expect(en).toContain("'=Supplier");expect(en).toContain("'=HYPERLINK");expect(en).toContain('""test""');expect(en).not.toContain("PRIVATE");
 expect((await db.query("SELECT count(*)::int AS n FROM journal_entry")).rows[0].n).toBe(before);
});

it("uses the same literal search, original-date and current-state filters as the history",async()=>{
 for(const filters of [{q:"GROUP-",from:"2026-06-05",to:"2026-06-05",status:"POSTED"},{from:"2026-06-04",to:"2026-06-04",status:"VOID"},{q:payments[0]!.number},{q:"missing%"},{from:"2026-06-06"},{q:"PRIVATE"}]){
  const listed=await listSupplierRefunds(reader,1,filters),exported=await exportSupplierRefunds(reader,filters);expect(exported).toHaveLength(listed.total);expect(exported.slice(0,25).map(row=>row.number)).toEqual(listed.refunds.map(row=>row.number));
 }
 expect((await exportSupplierRefunds(reader,{status:"VOID"}))[0]?.date).toBe("2026-06-04");
});

it("refuses oversized exports instead of returning partial data, and rejects malformed filters",async()=>{
 await expect(exportSupplierRefunds(reader,{}, {maxRows:26})).rejects.toMatchObject({key:"supplierRefunds.exportLimit"});
 expect(await exportSupplierRefunds(reader,{q:payments[0]!.number},{maxRows:1})).toHaveLength(1);expect(await exportSupplierRefunds(reader,{q:"missing"},{maxRows:0})).toEqual([]);
 for(const maxRows of [-1,1.5,10001,NaN,Infinity])await expect(exportSupplierRefunds(reader,{}, {maxRows})).rejects.toMatchObject({key:"payments.invalidFilters"});
 for(const filters of [{q:["a","b"]},{q:"\u0000"},{status:"DRAFT"},{from:"2026-06-31"},{from:"2026-06-06",to:"2026-06-05"},{page:2}])await expect(exportSupplierRefunds(reader,filters)).rejects.toMatchObject({key:"payments.invalidFilters"});
});

it("preserves frozen names with directories masked and enforces accounting and tenant isolation",async()=>{
 await db.query("UPDATE contact SET display_name='Current secret identity' WHERE id=$1",[W.supplier]);await db.query("UPDATE membership SET module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader,JSON.stringify({contacts:"none",sales:"none",taxes:"none",accounting:"read"})]);
 await expect(getContact(reader,W.supplier)).rejects.toThrow();expect((await exportSupplierRefunds(reader))[0]?.supplier).toBe('=Supplier%_\\"Nord');expect(await exportSupplierRefunds(reader,{q:"Current secret identity"})).toEqual([]);expect(await exportSupplierRefunds(other)).toEqual([]);
 await db.query("UPDATE membership SET module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader,JSON.stringify({accounting:"none"})]);await expect(exportSupplierRefunds(reader)).rejects.toMatchObject({key:"forbidden"});
});
