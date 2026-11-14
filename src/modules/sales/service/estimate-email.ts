import "server-only";
import { z } from "zod";
import { requireRole } from "@/modules/companies";
import { formatMoney, todayIso } from "@/modules/ledger";
import { AppError, toAppError } from "@/platform/errors";
import { withCompany, type CompanyContext, type Tx } from "@/platform/tenant";
import { deliverMail, mailConfigured, requireMailConfigured } from "@/platform/mail";
import { estimateTaxSchema, snapshotSchema } from "../domain/estimate";
import { estimateMail } from "../domain/email";

const inputSchema = z.object({ attemptId: z.uuid(), recipient: z.email().max(254).refine(v => !/[\x00-\x1f\x7f,;<>]/.test(v)), locale: z.enum(["fr-CA", "en"]), confirmResend: z.boolean() });
const localeSchema = z.enum(["fr-CA", "en"]);
function address(value: ReturnType<typeof snapshotSchema.parse>) {
  return [value.name, value.legalName, value.addressLine1, value.addressLine2, value.city, value.province, value.postalCode, value.country, value.gstNumber, value.qstNumber].filter((v): v is string => Boolean(v));
}

/** Select only public fields. Internal notes are never loaded by this mail path. */
async function previewWithin(tx: Tx, actor: CompanyContext, id: string, locale: "fr-CA" | "en") {
  const row = await tx.salesEstimate.findFirst({ where: { companyId: actor.companyId, id, status: "SENT", validUntil: { gte: new Date(`${todayIso()}T00:00:00Z`) } }, select: {
    number: true, issueDate: true, validUntil: true, reference: true, terms: true, issuerSnapshot: true, customerSnapshot: true,
    subtotalCents: true, totalCents: true, taxSummary: true,
    lines: { orderBy: { position: "asc" }, select: { description: true, quantity: true, unitPrice: true, amountCents: true } },
  } });
  if (!row?.number) return null;
  const customer = snapshotSchema.parse(row.customerSnapshot), issuer = snapshotSchema.parse(row.issuerSnapshot);
  const money = (c: bigint) => formatMoney(c, locale);
  const message = estimateMail({ number: row.number, issuer: address(issuer), customer: address(customer), issueDate: row.issueDate.toISOString().slice(0, 10), dueDate: row.validUntil.toISOString().slice(0, 10), reference: row.reference, terms: row.terms,
    lines: row.lines.map(l => ({ description: l.description, quantity: l.quantity.toString(), unitPrice: l.unitPrice.toString(), amount: money(l.amountCents) })),
    taxes: estimateTaxSchema.parse(row.taxSummary).map(t => ({ label: t.code, amount: money(BigInt(t.amountCents)) })), subtotal: money(row.subtotalCents), total: money(row.totalCents) }, locale);
  return { number: row.number, recipient: customer.email ?? "", message };
}

export async function previewEstimateEmail(actor: CompanyContext, id: string, locale: "fr-CA" | "en") {
  if (!z.uuid().safeParse(id).success || !localeSchema.safeParse(locale).success) throw new AppError("estimateEmail.invalid");
  return withCompany(actor, async tx => { await requireRole(tx, "sales.read"); return previewWithin(tx, actor, id, locale); });
}

export async function getEstimateEmails(actor: CompanyContext, estimateId: string) {
  if (!z.uuid().safeParse(estimateId).success) throw new AppError("estimateEmail.invalid");
  return withCompany(actor, async tx => {
    await requireRole(tx, "sales.read");
    const attempts = await tx.estimateEmail.findMany({ where: { companyId: actor.companyId, estimateId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 21 });
    return { configured: mailConfigured(), attempts };
  });
}

/** Reserve once while holding the estimate row; SMTP never holds a database transaction. */
export async function sendEstimateEmail(actor: CompanyContext, estimateId: string, raw: z.input<typeof inputSchema>) {
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success || !z.uuid().safeParse(estimateId).success) throw new AppError("estimateEmail.invalid");
  const input = parsed.data;
  let reserved;
  try {
    reserved = await withCompany(actor, async tx => {
      await requireRole(tx, "sales.manage");
      const locks = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM sales_estimate WHERE company_id=${actor.companyId}::uuid AND id=${estimateId}::uuid FOR UPDATE`;
      if (!locks[0]) throw new AppError("estimateEmail.unavailable");
      const existing = await tx.estimateEmail.findFirst({ where: { companyId: actor.companyId, id: input.attemptId } });
      if (existing) {
        if (existing.estimateId !== estimateId || existing.recipient !== input.recipient || existing.locale !== input.locale) throw new AppError("estimateEmail.invalid");
        return { existing };
      }
      const preview = await previewWithin(tx, actor, estimateId, input.locale);
      if (!preview) throw new AppError("estimateEmail.unavailable");
      requireMailConfigured();
      const attempts = await tx.estimateEmail.findMany({ where: { companyId: actor.companyId, estimateId }, orderBy: { createdAt: "desc" }, take: 20 });
      if (attempts.length && !input.confirmResend) throw new AppError("estimateEmail.confirmResend");
      const now = Date.now();
      if (attempts.some(a => a.createdAt.getTime() > now - 60_000 || (a.status === "PENDING" && a.createdAt.getTime() > now - 300_000)) || attempts.filter(a => a.createdAt.getTime() > now - 86_400_000).length >= 20) throw new AppError("estimateEmail.rate");
      const attempt = await tx.estimateEmail.create({ data: { id: input.attemptId, companyId: actor.companyId, estimateId, recipient: input.recipient, locale: input.locale, createdById: actor.userId } });
      return { attempt, message: preview.message };
    });
  } catch (error) { throw toAppError(error); }
  if (reserved.existing) return reserved.existing;
  const status = await deliverMail({ ...reserved.message!, to: input.recipient, attemptId: input.attemptId });
  try {
    return await withCompany(actor, async tx => {
      await requireRole(tx, "sales.manage");
      return tx.estimateEmail.update({ where: { id: input.attemptId, companyId: actor.companyId }, data: { status, completedAt: new Date() } });
    });
  } catch { throw new AppError("invoiceEmail.uncertain"); }
}
