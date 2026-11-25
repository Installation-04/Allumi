/** Real-service financial fixtures for the disposable client-portal journey only. */
import { closePrisma } from '@/platform/db';
import { initializeLedger,createAccount } from '@/modules/ledger';
import { saveContact } from '@/modules/contacts';
import { createTaxCode } from '@/modules/taxes';
import { saveEstimate,getEstimate,transitionEstimate,saveDraft,getDraft,postInvoice } from '@/modules/sales';
import { E2E_DB } from './db';
for(const key of ['DATABASE_URL','APP_DATABASE_URL'])if(new URL(process.env[key]??'').pathname!==`/${E2E_DB}`)throw new Error('Refusing non-E2E database');
process.env.APP_URL=`http://127.0.0.1:${process.env.E2E_PORT??3100}`;process.env.AUTH_SECRET='e2e-contracts-only-e2e-contracts-only';process.env.ENCRYPTION_KEY=Buffer.alloc(32,7).toString('base64');
const [userId,companyId]=process.argv.slice(2);if(![userId,companyId].every(id=>id&&/^[0-9a-f-]{36}$/.test(id)))throw new Error('Invalid fixture identifiers');
const actor={userId:userId!,companyId:companyId!};
try{
 await initializeLedger(actor,new Date('2026-06-01T12:00:00Z'));
 const customer=await saveContact(actor,{kind:'CUSTOMER',displayName:'Client Portail Exemple',email:'signature96@example.test',notes:'CLIENT-PORTAL-PRIVATE-CONTACT'});
 const revenue=await createAccount(actor,{code:'CT96-REV',nameFr:'Services de référence',nameEn:'Reference services',type:'REVENUE',subtype:'OPERATING_REVENUE'});
 const taxCodeId=await createTaxCode(actor,{code:'CT96-EX',nameFr:'Service exonéré de référence',nameEn:'Reference exempt service',treatment:'EXEMPT',taxIds:[]});
 const input={contactId:customer.id,issueDate:'2026-06-01',dueDate:'2999-01-01',reference:'CT96-REFERENCE',terms:'Modalités publiques {{hourly_rate}}. Rappel {{hourly_rate}}.',hourlyRate:'125.99',memo:'CLIENT-PORTAL-PRIVATE-MEMO',lines:[{description:'Service de référence public',quantity:'1',unitPrice:'100',accountId:revenue.id,taxCodeId}]};
 const estimate=await saveEstimate(actor,input);await transitionEstimate(actor,estimate,(await getEstimate(actor,estimate))!.revision,'SENT');
 const invoice=await saveDraft(actor,{...input,memo:'Instruction publique pour la facture'});await postInvoice(actor,invoice,(await getDraft(actor,invoice))!.revision,'2026-06-01');
 process.stdout.write(JSON.stringify({estimate,invoice}));
}finally{await closePrisma();}
