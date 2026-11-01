import { randomUUID } from "node:crypto";
import { afterAll,beforeAll,expect,it,vi } from "vitest";
import type pg from "pg";
import { getInvoiceEmails,sendInvoiceEmail,saveDraft,getDraft,postInvoice,voidInvoice } from "@/modules/sales";
import { withCompany } from "@/platform/tenant";
import { owner } from "./helpers";
import { seedWorld,W } from "./world";
const mail=vi.hoisted(()=>({deliver:vi.fn().mockResolvedValue("ACCEPTED"),configured:vi.fn()}));
vi.mock("@/platform/mail",()=>({deliverMail:mail.deliver,requireMailConfigured:mail.configured,mailConfigured:()=>true}));
const actor={userId:W.userOwnerA,companyId:W.companyA},seller={...actor,userId:W.userAccountant};
let db:pg.Client;
async function invoice(posted=true) {
 const id=await saveDraft(actor,{contactId:W.customer,issueDate:"2026-06-01",dueDate:"2026-07-01",lines:[{description:'Service <script>alert("test")</script>',quantity:"1",unitPrice:"100",accountId:W.sales,taxCodeId:W.taxCodeStandard}]});
 if(posted) await postInvoice(actor,id,(await getDraft(actor,id))!.revision,"2026-06-01");
 return id;
}
const input=()=>({attemptId:randomUUID(),recipient:"client@example.test",locale:"fr-CA" as const,confirmResend:false});
beforeAll(async()=>{db=await owner();await seedWorld(db);await db.query("INSERT INTO number_sequence(company_id,key,next_value,prefix,padding) VALUES ($1,'JOURNAL_ENTRY',1,'J-',5),($1,'INVOICE',1,'F-',5)",[W.companyA]);await db.query("UPDATE membership SET module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userAccountant,JSON.stringify({sales:"write",accounting:"none"})]);});
afterAll(async()=>{await db?.end();});
it("refuses draft, read-only, cross-tenant and invalid recipient before I/O",async()=>{
 const draft=await invoice(false),id=await invoice(),attempt=input();
 const start=mail.deliver.mock.calls.length;
 await expect(sendInvoiceEmail(actor,draft,attempt)).rejects.toMatchObject({key:"invoiceEmail.unavailable"});
 await expect(sendInvoiceEmail({...actor,userId:W.userReader},id,attempt)).rejects.toThrow();
 await expect(sendInvoiceEmail({userId:W.userOwnerB,companyId:W.companyB},id,attempt)).rejects.toThrow();
 await expect(sendInvoiceEmail(seller,id,{...attempt,recipient:"a@example.test\r\nBcc: other@example.test"})).rejects.toMatchObject({key:"invoiceEmail.invalid"});
 expect(mail.deliver).toHaveBeenCalledTimes(start);
 expect((await getInvoiceEmails(actor,id)).attempts).toHaveLength(0);
});
it("sends once under concurrent replay, renders frozen details and records SMTP acceptance",async()=>{
 const id=await invoice(),attempt=input();
 const frozen=(await db.query("SELECT issuer_snapshot, billing_snapshot FROM sales_document WHERE id=$1",[id])).rows[0];
 await db.query("UPDATE company SET name='Changed company after posting' WHERE id=$1",[W.companyA]);
 await db.query("UPDATE contact SET display_name='Changed client after posting' WHERE id=$1",[W.customer]);
 const before=mail.deliver.mock.calls.length;
 const [a,b]=await Promise.all([sendInvoiceEmail(seller,id,attempt),sendInvoiceEmail(seller,id,attempt)]);
 expect(a.id).toBe(b.id);expect(mail.deliver).toHaveBeenCalledTimes(before+1);
 const message=mail.deliver.mock.calls.at(-1)![0];
 expect(message.text).toContain(frozen.issuer_snapshot.name);expect(message.text).toContain(frozen.billing_snapshot.name);expect(message.text).not.toContain("Changed company after posting");
 expect(message.html).toContain("&lt;script&gt;");expect(message.html).not.toContain("<script>");expect(message.text).toContain("114,98");expect(message.html).not.toContain("/c/");
 const history=await getInvoiceEmails(seller,id);expect(history.attempts).toHaveLength(1);expect(history.attempts[0]!.status).toBe("ACCEPTED");
 await expect(sendInvoiceEmail(seller,id,{...attempt,recipient:"other@example.test"})).rejects.toMatchObject({key:"invoiceEmail.invalid"});
 await expect(sendInvoiceEmail(seller,id,input())).rejects.toMatchObject({key:"invoiceEmail.confirmResend"});
 await expect(sendInvoiceEmail(seller,id,{...input(),confirmResend:true})).rejects.toMatchObject({key:"invoiceEmail.rate"});
 await expect(withCompany(actor,tx=>tx.$executeRaw`UPDATE invoice_email SET recipient='forged@example.test' WHERE id=${attempt.attemptId}::uuid`)).rejects.toThrow();
 await expect(withCompany(actor,tx=>tx.invoiceEmail.delete({where:{id:attempt.attemptId}}))).rejects.toThrow();
 await expect(db.query("UPDATE invoice_email SET status='UNKNOWN' WHERE id=$1",[attempt.attemptId])).rejects.toMatchObject({code:"AL004"});
});
it("records uncertainty without retry and blocks insertion for drafts even via SQL",async()=>{
 const id=await invoice();mail.deliver.mockResolvedValueOnce("UNKNOWN");const attempt=input();
 expect((await sendInvoiceEmail(seller,id,attempt)).status).toBe("UNKNOWN");
 const calls=mail.deliver.mock.calls.length;expect((await sendInvoiceEmail(seller,id,attempt)).status).toBe("UNKNOWN");expect(mail.deliver).toHaveBeenCalledTimes(calls);
 const draft=await invoice(false);
 await expect(withCompany(actor,tx=>tx.invoiceEmail.create({data:{id:randomUUID(),companyId:actor.companyId,documentId:draft,recipient:"test@example.test",locale:"en",createdById:actor.userId}}))).rejects.toThrow();
});
it("serializes distinct concurrent submissions and enforces throttle and identity in SQL",async()=>{
 const id=await invoice(),before=mail.deliver.mock.calls.length;
 const results=await Promise.allSettled([sendInvoiceEmail(seller,id,{...input(),confirmResend:true}),sendInvoiceEmail(seller,id,{...input(),confirmResend:true})]);
 expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
 expect(results.find(r=>r.status==="rejected")).toMatchObject({reason:{key:"invoiceEmail.rate"}});
 expect(mail.deliver).toHaveBeenCalledTimes(before+1);
 const data={id:randomUUID(),companyId:actor.companyId,documentId:id,recipient:"raw@example.test",locale:"en",createdById:actor.userId};
 await expect(withCompany(actor,tx=>tx.invoiceEmail.create({data}))).rejects.toThrow();
 const otherId=await invoice();
 await expect(withCompany(actor,tx=>tx.invoiceEmail.create({data:{...data,id:randomUUID(),documentId:otherId,createdById:W.userOwnerB}}))).rejects.toThrow();
 const created=await withCompany(actor,tx=>tx.invoiceEmail.create({data:{...data,id:randomUUID(),documentId:otherId,createdAt:new Date("2010-01-01")}}));
 expect(created.createdAt.getTime()).toBeGreaterThan(Date.now()-60_000);
});
it("requires configured SMTP, refuses void invoices and applies permission revocation to raw history",async()=>{
 const id=await invoice();mail.configured.mockImplementationOnce(()=>{throw new Error("unconfigured");});
 await expect(sendInvoiceEmail(seller,id,input())).rejects.toThrow("unconfigured");expect((await getInvoiceEmails(seller,id)).attempts).toHaveLength(0);
 await sendInvoiceEmail(seller,id,{...input(),locale:"en"});expect(mail.deliver.mock.calls.at(-1)![0].subject).toContain("Invoice F-");
 await voidInvoice(actor,id,"2026-06-02","Test cancellation");
 await expect(sendInvoiceEmail(seller,id,input())).rejects.toMatchObject({key:"invoiceEmail.unavailable"});
 await db.query("UPDATE membership SET module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userAccountant,JSON.stringify({sales:"none",accounting:"write"})]);
 await expect(getInvoiceEmails(seller,id)).rejects.toThrow();
 expect(await withCompany(seller,tx=>tx.invoiceEmail.findMany())).toEqual([]);
 expect(await withCompany({userId:W.userOwnerB,companyId:W.companyB},tx=>tx.invoiceEmail.findMany())).toEqual([]);
});
