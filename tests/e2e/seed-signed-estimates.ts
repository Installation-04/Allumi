/** Real-service signed estimate fixtures for the disposable review journey. */
import { closePrisma } from "@/platform/db";
import { initializeLedger, createAccount } from "@/modules/ledger";
import { saveContact } from "@/modules/contacts";
import { createTaxCode } from "@/modules/taxes";
import { saveEstimate, getEstimate, transitionEstimate } from "@/modules/sales";
import { prepareSourceDocument, publishClientDocument, openClientDocument, signClientDocument } from "@/modules/contracts";
import { E2E_DB } from "./db";
for (const key of ["DATABASE_URL","APP_DATABASE_URL"]) if (new URL(process.env[key]??"").pathname!==`/${E2E_DB}`) throw new Error("Refusing non-E2E database");
process.env.APP_URL??=`http://127.0.0.1:${process.env.E2E_PORT??3100}`;process.env.AUTH_SECRET??="e2e-only-secret-e2e-only-secret-e2e-only";process.env.ENCRYPTION_KEY??=Buffer.alloc(32,7).toString("base64");
const [userId,companyId]=process.argv.slice(2);if(![userId,companyId].every(id=>id&&/^[0-9a-f-]{36}$/.test(id)))throw new Error("Invalid fixture identifiers");
const actor={userId:userId!,companyId:companyId!},email="review107@example.test";
try {
 await initializeLedger(actor,new Date("2026-06-01T12:00:00Z"));
 const customer=await saveContact(actor,{kind:"CUSTOMER",displayName:"Camille Revue",email,notes:"PRIVATE-REVIEW-CONTACT-107"});
 const revenue=await createAccount(actor,{code:"SG107-REV",nameFr:"Services après revue",nameEn:"Reviewed services",type:"REVENUE",subtype:"OPERATING_REVENUE"});
 const taxCodeId=await createTaxCode(actor,{code:"SG107-EX",nameFr:"Service exonéré après revue",nameEn:"Reviewed exempt service",treatment:"EXEMPT",taxIds:[]});
 const make=async(reference:string,signed:boolean)=>{
  const estimate=await saveEstimate(actor,{contactId:customer.id,issueDate:"2026-06-01",dueDate:"2999-01-01",reference,terms:"Conditions du service : {{hourly_rate}}.\nLa signature reste soumise à la revue interne de la soumission.",hourlyRate:"125.99",memo:"PRIVATE-REVIEW-MEMO-107",lines:[{description:"Service convenu après revue",quantity:"1",unitPrice:"100",accountId:revenue.id,taxCodeId}]});
  await transitionEstimate(actor,estimate,(await getEstimate(actor,estimate))!.revision,"SENT");
  const document=await prepareSourceDocument(actor,"ESTIMATE",estimate,email,"fr-CA"),url=await publishClientDocument(actor,document,1,true);
  if(signed){const token=new URL(url).pathname.split('/').at(-1)!,opened=(await openClientDocument(token,"192.0.2.117"))!;await signClientDocument(token,{name:"Camille Revue",email,hash:opened.hash,consent:true},"192.0.2.117");}
  return {estimate,document};
 };
 const primary=await make("REVUE-PRINCIPALE",true),modular=await make("REVUE-MODULAIRE",true),unsigned=await make("REVUE-NON-SIGNEE",false);
 process.stdout.write(JSON.stringify({primary,modular,unsigned}));
} finally {await closePrisma();}
