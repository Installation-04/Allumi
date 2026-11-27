/** Fictional contracts only; no mail or financial postings. */
import { closePrisma } from "@/platform/db";
import { saveContract, publishClientDocument, openClientDocument, signClientDocument } from "@/modules/contracts";
import { E2E_DB } from "./db";
for(const key of ["DATABASE_URL","APP_DATABASE_URL"])if(new URL(process.env[key]??"").pathname!==`/${E2E_DB}`)throw new Error("Refusing non-E2E database");
const [userId,companyId]=process.argv.slice(2);if(![userId,companyId].every(id=>id&&/^[0-9a-f-]{36}$/.test(id)))throw new Error("Invalid fixture identifiers");
const actor={userId:userId!,companyId:companyId!},email="copy108@example.test";
try{
 const make=async(locale:"fr-CA"|"en",signed:boolean)=>{
  const id=await saveContract(actor,{title:locale==="en"?"Your signed service contract":"Ton contrat de service signé",customerName:"Camille Copie",customerEmail:email,locale,hourlyRate:"125.99",body:"{{company_name}}\n{{client_name}}\n"+(locale==="en"?"Agreed hourly rate: {{hourly_rate}}.\nPlease keep a copy of the agreed terms.":"Tarif horaire convenu : {{hourly_rate}}.\nConserve une copie des conditions convenues.")}),url=await publishClientDocument(actor,id,1,true);
  if(signed){const t=new URL(url).pathname.split('/').at(-1)!,d=(await openClientDocument(t,"192.0.2.118"))!;await signClientDocument(t,{name:"Camille Copie",email,hash:d.hash,consent:true},"192.0.2.118");}
  return{id,url};
 };
 process.stdout.write(JSON.stringify({fr:await make("fr-CA",false),en:await make("en",true),unsigned:await make("fr-CA",false)}));
}finally{await closePrisma();}
