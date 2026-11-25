import { z } from "zod";
import { formatMoney, type Locale } from "@/modules/ledger/client";
const amount=z.string().regex(/^\d{1,16}$/);
const snapshot=z.object({number:z.string(),reference:z.string().nullable().optional(),note:z.string().nullable().optional(),date:z.string(),due:z.string().nullable(),issuer:z.record(z.string(),z.unknown()),customer:z.record(z.string(),z.unknown()),terms:z.string().nullable().optional(),subtotal:amount,total:amount,taxes:z.array(z.object({code:z.string(),amountCents:amount})).max(10),lines:z.array(z.object({description:z.string(),quantity:z.string(),unitPrice:z.string(),amountCents:amount})).min(1).max(50)});
export function sourceDocumentText(payload:unknown,locale:Locale):string {
 const d=snapshot.parse(payload),en=locale==="en";
 const address=(v:Record<string,unknown>)=>['name','legalName','addressLine1','addressLine2','city','province','postalCode','country','gstNumber','qstNumber'].flatMap(k=>typeof v[k]==='string'?[v[k] as string]:[]);
 const money=(v:string)=>formatMoney(BigInt(v),locale);
 return [...address(d.issuer),'',...address(d.customer),'',`${en?'Date':'Date'}: ${d.date}`,...(d.reference?[`${en?'Reference':'Référence'}: ${d.reference}`]:[]),...(d.due?[`${en?'Due / valid until':'Échéance / validité'}: ${d.due}`]:[]),'',...d.lines.map(l=>`${l.description}\n${l.quantity} × ${l.unitPrice} CAD — ${money(l.amountCents)}`),'',`${en?'Subtotal':'Sous-total'}: ${money(d.subtotal)}`,...d.taxes.map(t=>`${t.code}: ${money(t.amountCents)}`),`${en?'Total (CAD)':'Total (CAD)'}: ${money(d.total)}`,...(d.terms?['',en?'Terms':'Conditions',d.terms]:[]),...(d.note?['',en?'Note':'Note',d.note]:[])].join('\n');
}
