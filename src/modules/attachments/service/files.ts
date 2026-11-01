import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { requireRole } from "@/modules/companies";
import { AppError, toAppError } from "@/platform/errors";
import { withCompany, type CompanyContext } from "@/platform/tenant";
import { inspectFile } from "../domain/file";
type Target = "purchase" | "sales";
const linkFor = (target: Target, id: string) => target === "sales" ? { salesDocumentId: id } : { purchaseDocumentId: id };
const scopeFor = (target: Target) => target === "sales" ? "sales" : "accounting";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function pathFor(companyId: string, key: string) {
 if (!uuid.test(companyId) || !new RegExp(`^${companyId.toLowerCase()}/[0-9]{4}/[0-9]{2}/[0-9a-f-]{36}$`).test(key)) throw new AppError("attachments.unavailable");
 return join(resolve(process.env.ATTACHMENTS_DIR ?? "/app/storage/attachments"), key);
}
export async function listPurchaseAttachments(actor: CompanyContext, documentId: string, target: Target = "purchase") {
 if (!uuid.test(documentId)) throw new AppError("attachments.unavailable");
 return withCompany(actor, async tx => {
  await requireRole(tx,target === "sales" ? "sales.read" : "ledger.read");
  if (!await (target === "sales" ? tx.salesDocument.findFirst({where:{companyId:actor.companyId,id:documentId}}) : tx.purchaseDocument.findFirst({where:{companyId:actor.companyId,id:documentId}}))) throw new AppError("attachments.unavailable");
  const files=await tx.attachment.findMany({where:{companyId:actor.companyId,scope:scopeFor(target),deletedAt:null,links:{some:{companyId:actor.companyId,...linkFor(target,documentId)}}},select:{id:true,fileName:true,sizeBytes:true,createdAt:true},orderBy:[{createdAt:"asc"},{id:"asc"}],take:20});
  const doc=await (target === "sales" ? tx.salesDocument.findFirstOrThrow({where:{companyId:actor.companyId,id:documentId},select:{status:true}}) : tx.purchaseDocument.findFirstOrThrow({where:{companyId:actor.companyId,id:documentId},select:{status:true}}));
  return {files, draft:doc.status==="DRAFT"};
 });
}
export async function uploadPurchaseAttachment(actor: CompanyContext, documentId: string, fileName: string, data: Uint8Array, target: Target = "purchase") {
 const file = inspectFile(fileName,data);
 if (!file) throw new AppError("attachments.invalid");
 if (!uuid.test(documentId)) throw new AppError("attachments.unavailable");
 const id=randomUUID(), day=new Date().toISOString();
 const key=`${actor.companyId.toLowerCase()}/${day.slice(0,4)}/${day.slice(5,7)}/${id}`;
 const path=pathFor(actor.companyId,key);
 let written=false, callbackComplete=false;
 try { return await withCompany(actor,async tx=>{
  await requireRole(tx,target === "sales" ? "sales.manage" : "entry.post");
  const locked=target === "sales" ? await tx.$queryRaw<{id:string}[]>`SELECT id FROM sales_document WHERE company_id=${actor.companyId}::uuid AND id=${documentId}::uuid FOR UPDATE` : await tx.$queryRaw<{id:string}[]>`SELECT id FROM purchase_document WHERE company_id=${actor.companyId}::uuid AND id=${documentId}::uuid FOR UPDATE`;
  if (!locked.length) throw new AppError("attachments.unavailable");
  if (await tx.attachmentLink.count({where:{companyId:actor.companyId,...linkFor(target,documentId)}})>=20) throw new AppError("attachments.limit");
  await mkdir(dirname(path),{recursive:true,mode:0o700});
  await writeFile(path,data,{flag:"wx",mode:0o600}); written=true;
  await tx.attachment.create({data:{id,companyId:actor.companyId,scope:scopeFor(target),storageKey:key,fileName:file.name,mimeType:file.mime,sizeBytes:data.length,sha256:createHash("sha256").update(data).digest("hex"),uploadedById:actor.userId}});
  await tx.attachmentLink.create({data:{companyId:actor.companyId,attachmentId:id,...linkFor(target,documentId)}});
  callbackComplete=true;
  return id;
 }); } catch(error) {
  // Never remove a file after an uncertain commit: a retained private orphan is preferable to a missing receipt.
  if (written && !callbackComplete) await unlink(path).catch(()=>{});
  throw toAppError(error);
 }
}
export async function downloadPurchaseAttachment(actor: CompanyContext, documentId: string, id: string, target: Target = "purchase") {
 if (!uuid.test(documentId) || !uuid.test(id)) throw new AppError("attachments.unavailable");
 const file=await withCompany(actor,async tx=>{
  await requireRole(tx,target === "sales" ? "sales.read" : "ledger.read");
  return tx.attachment.findFirst({where:{companyId:actor.companyId,id,scope:scopeFor(target),deletedAt:null,links:{some:{companyId:actor.companyId,...linkFor(target,documentId)}}}});
 });
 if (!file) throw new AppError("attachments.unavailable");
 let data: Buffer;
 try { data=await readFile(pathFor(actor.companyId,file.storageKey)); } catch { throw new AppError("attachments.unavailable"); }
 if (data.length!==file.sizeBytes || createHash("sha256").update(data).digest("hex")!==file.sha256) throw new AppError("attachments.unavailable");
 return {data,fileName:file.fileName,mimeType:file.mimeType};
}

export async function detachPurchaseAttachment(actor: CompanyContext, documentId: string, id: string, target: Target = "purchase") {
 if (!uuid.test(documentId) || !uuid.test(id)) throw new AppError("attachments.unavailable");
 try { return await withCompany(actor,async tx=>{
  await requireRole(tx,target === "sales" ? "sales.manage" : "entry.post");
  const rows=target === "sales" ? await tx.$queryRaw<{status:string}[]>`SELECT status FROM sales_document WHERE company_id=${actor.companyId}::uuid AND id=${documentId}::uuid FOR UPDATE` : await tx.$queryRaw<{status:string}[]>`SELECT status FROM purchase_document WHERE company_id=${actor.companyId}::uuid AND id=${documentId}::uuid FOR UPDATE`;
  if (!rows.length) throw new AppError("attachments.unavailable");
  if (rows[0]?.status!=="DRAFT") throw new AppError("attachments.retained");
  const link=await tx.attachmentLink.findFirst({where:{companyId:actor.companyId,...linkFor(target,documentId),attachmentId:id}});
  if (!link) throw new AppError("attachments.unavailable");
  await tx.attachmentLink.delete({where:{id:link.id,companyId:actor.companyId}});
  if (!await tx.attachmentLink.count({where:{companyId:actor.companyId,attachmentId:id}})) await tx.attachment.update({where:{id,companyId:actor.companyId},data:{deletedAt:new Date()}});
 }); } catch(error) { throw toAppError(error); }
}

export const listSalesAttachments = (actor: CompanyContext, documentId: string) => listPurchaseAttachments(actor,documentId,"sales");
export const uploadSalesAttachment = (actor: CompanyContext, documentId: string, fileName: string, data: Uint8Array) => uploadPurchaseAttachment(actor,documentId,fileName,data,"sales");
export const downloadSalesAttachment = (actor: CompanyContext, documentId: string, id: string) => downloadPurchaseAttachment(actor,documentId,id,"sales");
export const detachSalesAttachment = (actor: CompanyContext, documentId: string, id: string) => detachPurchaseAttachment(actor,documentId,id,"sales");
