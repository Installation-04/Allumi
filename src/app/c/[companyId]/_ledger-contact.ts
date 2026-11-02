import "server-only";
import { notFound } from "next/navigation";
import { findLedgerContact } from "@/modules/reports";
import type { Actor } from "@/modules/ledger";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** An invalid filter must never silently become an unfiltered financial report. */
export async function resolveLedgerContact(actor:Actor,raw:string|string[]|undefined){
 if(Array.isArray(raw)&&raw.length!==1)notFound();
 const id=(Array.isArray(raw)?raw[0]:raw)?.trim();if(!id)return null;
 if(!UUID.test(id))notFound();
 const contact=await findLedgerContact(actor,id);if(!contact)notFound();return contact;
}
