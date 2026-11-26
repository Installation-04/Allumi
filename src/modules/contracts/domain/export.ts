import { toCsv, csvFormatFor } from "@/modules/reports/client";
import type { Locale } from "@/modules/ledger/client";
import { CLIENT_DOCUMENT_EXPORT_LIMIT, type DOCUMENT_KINDS, type DOCUMENT_STAGES, type LINK_STATES } from "./tracking";
export type ClientDocumentExportRow={id:string;title:string;customerName:string;kind:typeof DOCUMENT_KINDS[number];stage:typeof DOCUMENT_STAGES[number];linkState:typeof LINK_STATES[number];publishedAt:string;firstViewedAt:string;signedAt:string;expiresAt:string;capturedAt:string};
type Label='csvReference'|'documentTitle'|'customer'|'kindFilter'|'stageFilter'|'linkFilter'|'publishedAt'|'viewedAt'|'signedAt'|'expiresAt'|'csvCapturedAt'|'linkDraft'|typeof DOCUMENT_KINDS[number]|typeof DOCUMENT_STAGES[number]|typeof LINK_STATES[number];
// Defuse formulas even when a foreign text value has leading whitespace.
const text=(s:string)=>/^\s*[=+\-@]/u.test(s)?`'${s}`:s;
export function clientDocumentsCsv(rows:readonly ClientDocumentExportRow[],locale:Locale,t:(key:Label)=>string){
 if(rows.length>CLIENT_DOCUMENT_EXPORT_LIMIT)throw new RangeError('document export limit');
 const headers=['csvReference','documentTitle','customer','kindFilter','stageFilter','linkFilter','publishedAt','viewedAt','signedAt','expiresAt','csvCapturedAt'] as const;
 return toCsv([headers.map(k=>t(k)+(k==='publishedAt'||k==='viewedAt'||k==='signedAt'||k==='expiresAt'||k==='csvCapturedAt'?' (UTC ISO 8601)':'')),...rows.map(d=>[d.id,d.title,d.customerName,t(d.kind),t(d.stage),t(d.linkState==='DRAFT'?'linkDraft':d.linkState),d.publishedAt,d.firstViewedAt,d.signedAt,d.expiresAt,d.capturedAt])].map(r=>r.map(text)),csvFormatFor(locale));
}
