import { getTranslations } from "next-intl/server";
import { can, type AccessContext } from "@/modules/companies";
import { listPurchaseAttachments } from "@/modules/attachments";
import { ActionForm } from "@/app/_components/ui";
import { detachAction, uploadAction } from "./actions";
export async function PurchaseAttachments({actor,access,documentId}:{actor:{userId:string;companyId:string};access:AccessContext;documentId:string}) {
 const t=await getTranslations("attachments");
 const {files,draft}=await listPurchaseAttachments(actor,documentId);
 return <section className="space-y-3 rounded border p-4" aria-label={t("title")}><h2 className="font-semibold">{t("title")}</h2><p>{t("hint")}</p>{!files.length && <p>{t("empty")}</p>}<ul>{files.map(file=><li key={file.id} className="break-words"><a className="inline-flex min-h-11 items-center underline" href={`/c/${actor.companyId}/pieces-jointes/${documentId}/${file.id}`}>{file.fileName}</a> · {file.sizeBytes} {t("bytes")}{draft && can(access,"entry.post") && <ActionForm action={detachAction.bind(null,actor.companyId,documentId,file.id)} label={t("remove")}><label className="flex min-h-11 items-center gap-2"><input type="checkbox" name="confirm" value="yes" required />{t("confirm")}</label></ActionForm>}</li>)}</ul>{can(access,"entry.post") && files.length<20 && <ActionForm action={uploadAction.bind(null,actor.companyId,documentId)} label={t("upload")}><label className="block">{t("file")}<input className="block min-h-11 w-full min-w-0" type="file" name="file" accept=".pdf,.png,.jpg,.jpeg" required /></label></ActionForm>}</section>;
}
