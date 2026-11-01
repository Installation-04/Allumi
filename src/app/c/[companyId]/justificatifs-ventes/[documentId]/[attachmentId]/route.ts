import { loadCompany } from "../../../_lib";
import { downloadSalesAttachment } from "@/modules/attachments";
import { AppError } from "@/platform/errors";
export async function GET(_request: Request,{params}:{params:Promise<{companyId:string;documentId:string;attachmentId:string}>}) {
 const {actor}=await loadCompany(params,"sales.read");
 const {documentId,attachmentId}=await params;
 try {
  const file=await downloadSalesAttachment(actor,documentId,attachmentId);
  return new Response(new Uint8Array(file.data),{headers:{"Content-Type":file.mimeType,"Content-Disposition":`attachment; filename="document"; filename*=UTF-8''${encodeURIComponent(file.fileName).replace(/['()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Content-Security-Policy":"sandbox; default-src 'none'"}});
 } catch(error) { if(error instanceof AppError) return new Response(null,{status:404,headers:{"Cache-Control":"private, no-store"}}); throw error; }
}
