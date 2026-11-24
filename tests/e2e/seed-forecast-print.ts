/** Real service fixtures for checking that printing never stops at the first 100 rows. */
import { closePrisma } from "@/platform/db";
import { getDraft,getInvoice,saveDraft,postInvoice } from "@/modules/sales";
import { E2E_DB } from "./db";
// This helper can only write to the explicitly disposable browser-test database.
for(const key of ["DATABASE_URL","APP_DATABASE_URL"]){if(new URL(process.env[key]??"").pathname!==`/${E2E_DB}`)throw new Error("Refusing non-E2E database");}
const [userId,companyId,contactId,accountId,taxCodeId]=process.argv.slice(2);
if(![userId,companyId,contactId,accountId,taxCodeId].every(id=>id&&/^[0-9a-f-]{36}$/.test(id)))throw new Error("Missing fixture identifiers");
const actor={userId:userId!,companyId:companyId!};
try{
 let first="",last="";
 for(let i=0;i<101;i++){
  const id=await saveDraft(actor,{contactId,issueDate:"2026-06-01",dueDate:"2026-07-05",memo:"FORECAST-PRINT-PRIVATE-MEMO",lines:[{description:"FORECAST-PRINT-PRIVATE-LINE",quantity:"1",unitPrice:"100",accountId,taxCodeId}]});
  await postInvoice(actor,id,(await getDraft(actor,id))!.revision,"2026-06-01");
  const number=(await getInvoice(actor,id))!.number;if(!number)throw new Error("Missing posted fixture number");if(i===0)first=number;last=number;
 }
 process.stdout.write(JSON.stringify({first,last,count:101}));
}finally{await closePrisma();}
