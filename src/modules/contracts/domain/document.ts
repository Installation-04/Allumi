import { z } from "zod";
import { templateText } from "@/modules/sales/client";
const line=(max:number)=>z.string().trim().min(1).refine(s=>[...s].length<=max&&!/[\p{Cc}\p{Zl}\p{Zp}]/u.test(s));
export const contractInput=z.object({title:line(160),customerName:line(200),customerEmail:z.email().max(254).refine(s=>!/[\x00-\x1f\x7f,;<>]/.test(s)),body:templateText.refine(s=>s.trim().length>0),hourlyRate:z.string().max(20).default(""),locale:z.enum(["fr-CA","en"])});
export const signatureInput=z.object({name:line(120),email:z.email().max(254),consent:z.literal(true),hash:z.string().regex(/^[0-9a-f]{64}$/)});
export type ContractInput=z.input<typeof contractInput>;
export type PublicClientDocument={id:string;kind:"CONTRACT"|"ESTIMATE"|"INVOICE";title:string;issuer:string;customer:string;recipient:string;locale:"fr-CA"|"en";body:string;hash:string;publishedAt:string;expiresAt:string;signedAt:string|null;signerName:string|null;signerEmail:string|null;consentText:string|null;canSign:boolean};
export const signatureConsent=(locale:string)=>locale==="en"?"I have reviewed this document and agree to sign it electronically. I confirm that I am authorized to sign for the named client.":"J’ai consulté ce document et j’accepte de le signer électroniquement. Je confirme être autorisé à signer pour le client indiqué.";
