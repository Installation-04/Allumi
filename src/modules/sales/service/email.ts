import "server-only";
import { z } from "zod";
import { requireRole } from "@/modules/companies";
import { formatMoney } from "@/modules/ledger";
import { AppError, toAppError } from "@/platform/errors";
import { withCompany, type CompanyContext } from "@/platform/tenant";
import { deliverMail, mailConfigured, requireMailConfigured } from "@/platform/mail";
import { invoiceMail } from "../domain/email";

const inputSchema = z.object({ attemptId: z.uuid(), recipient: z.email().max(254).refine(v => !/[\x00-\x1f\x7f,;<>]/.test(v)), locale: z.enum(["fr-CA","en"]), confirmResend: z.boolean() });
function address(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const snapshot = value as Record<string,unknown>;
  return ["name","legalName","addressLine1","addressLine2","city","province","postalCode","country","gstNumber","qstNumber"].flatMap(k=>typeof snapshot[k] === "string" && snapshot[k] ? [snapshot[k] as string] : []);
}

export async function getInvoiceEmails(actor: CompanyContext, documentId: string) {
  return withCompany(actor, async tx => {
    await requireRole(tx,"sales.read");
    const attempts = await tx.invoiceEmail.findMany({where:{companyId:actor.companyId,documentId},orderBy:[{createdAt:"desc"},{id:"desc"}],take:21});
    return { configured: mailConfigured(), attempts };
  });
}

/** Reserve before I/O. A repeated submission returns its attempt without making another SMTP call. */
export async function sendInvoiceEmail(actor: CompanyContext, documentId: string, raw: z.input<typeof inputSchema>) {
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success || !z.uuid().safeParse(documentId).success) throw new AppError("invoiceEmail.invalid");
  const input = parsed.data;
  let reserved;
  try {
    reserved = await withCompany(actor, async tx => {
      await requireRole(tx,"sales.manage");
      const locks = await tx.$queryRaw<{id:string}[]>`SELECT id FROM sales_document WHERE company_id=${actor.companyId}::uuid AND id=${documentId}::uuid AND kind='INVOICE' AND status='POSTED' FOR UPDATE`;
      if (!locks[0]) throw new AppError("invoiceEmail.unavailable");
      const existing = await tx.invoiceEmail.findFirst({where:{companyId:actor.companyId,id:input.attemptId}});
      if (existing) {
        if (existing.documentId !== documentId || existing.recipient !== input.recipient || existing.locale !== input.locale) throw new AppError("invoiceEmail.invalid");
        return {existing};
      }
      requireMailConfigured();
      const attempts = await tx.invoiceEmail.findMany({where:{companyId:actor.companyId,documentId},orderBy:{createdAt:"desc"},take:20});
      if (attempts.length && !input.confirmResend) throw new AppError("invoiceEmail.confirmResend");
      const now = Date.now();
      if (attempts.some(a=>a.createdAt.getTime()>now-60_000 || (a.status==="PENDING" && a.createdAt.getTime()>now-300_000))
        || attempts.filter(a=>a.createdAt.getTime()>now-86_400_000).length>=20) throw new AppError("invoiceEmail.rate");
      const invoice = await tx.salesDocument.findFirstOrThrow({where:{companyId:actor.companyId,id:documentId},include:{lines:{orderBy:{position:"asc"}},taxes:{include:{tax:{select:{code:true}}}}}});
      const money=(c:bigint)=>formatMoney(c,input.locale);
      const message=invoiceMail({number:invoice.number!,issuer:address(invoice.issuerSnapshot),customer:address(invoice.billingSnapshot),issueDate:invoice.issueDate.toISOString().slice(0,10),dueDate:invoice.dueDate?.toISOString().slice(0,10)??null,reference:invoice.reference,memo:invoice.memo,
        lines:invoice.lines.map(l=>({description:l.description,quantity:l.quantity.toString(),unitPrice:l.unitPrice.toString(),amount:money(l.amountCents)})),
        taxes:invoice.taxes.map(t=>({label:t.tax.code,amount:money(t.amountCents)})),subtotal:money(invoice.subtotalCents),total:money(invoice.totalCents)},input.locale);
      const attempt=await tx.invoiceEmail.create({data:{id:input.attemptId,companyId:actor.companyId,documentId,recipient:input.recipient,locale:input.locale,createdById:actor.userId}});
      return {attempt,message};
    });
  } catch(error) { throw toAppError(error); }
  if (reserved.existing) return reserved.existing;
  // No database transaction is held while the relay responds. A process crash leaves PENDING;
  // a later explicit resend warns about duplicates. Never claim exactly-once delivery over SMTP.
  const status=await deliverMail({...reserved.message!,to:input.recipient,attemptId:input.attemptId});
  try {
    return await withCompany(actor,async tx=>{
      await requireRole(tx,"sales.manage");
      return tx.invoiceEmail.update({where:{id:input.attemptId,companyId:actor.companyId},data:{status,completedAt:new Date()}});
    });
  } catch { throw new AppError("invoiceEmail.uncertain"); }
}
