import { AppError } from "@/platform/errors";
import { notFound } from "next/navigation";
import { clientIp } from "@/app/_lib/session";
import { peekClientDocument } from "@/modules/contracts";
import { TranslationProvider } from "@/platform/i18n/client";
import fr from "../../../../messages/fr-CA.json";
import en from "../../../../messages/en.json";
import { DocumentPortal } from "./portal";
export const dynamic='force-dynamic';
export const metadata={title:'Document · Allumi',robots:{index:false,follow:false},referrer:'no-referrer' as const};
export default async function Page({params}:{params:Promise<{token:string}>}){const {token}=await params;let document;try{document=await peekClientDocument(token,await clientIp());}catch(error){if(!(error instanceof AppError&&error.key==="contracts.rateLimit"))throw error;return <p role="alert" className="p-6">Trop de demandes / Too many requests.</p>;}if(!document)notFound();const messages=document.locale==='en'?en:fr;return <TranslationProvider locale={document.locale} messages={{contracts:messages.contracts}} timeZone="America/Toronto"><DocumentPortal token={token} title={document.title} issuer={document.issuer}/></TranslationProvider>;}
