import "server-only";
import { z } from "zod";
import { requireRole } from "@/modules/companies";
import { formatMoney, todayIso, isValidIsoDate } from "@/modules/ledger";
import { AppError, toAppError } from "@/platform/errors";
import { withCompany, type CompanyContext, type Tx } from "@/platform/tenant";
import { deliverMail, mailConfigured, requireMailConfigured } from "@/platform/mail";
import { reminderMail } from "../domain/email";

const filters = z.object({ q: z.string().trim().max(120).regex(/^[^\x00-\x1f\x7f]*$/).default(""), page: z.number().int().min(1).max(1000).default(1) });
const sendSchema = z.object({
  attemptId: z.uuid(), recipient: z.email().max(254).refine(v => !/[\x00-\x1f\x7f,;<>]/.test(v)),
  locale: z.enum(["fr-CA", "en"]), confirmResend: z.boolean(),
  expectedOpenCents: z.string().regex(/^\d{1,15}$/), expectedDate: z.string().refine(isValidIsoDate), expectedDueDate: z.string().refine(isValidIsoDate),
});
const snapshot = (value: unknown, key: string) => value && typeof value === "object" && !Array.isArray(value) && key in value && typeof (value as Record<string, unknown>)[key] === "string" ? ((value as Record<string, string>)[key] ?? "") : "";
const iso = (value: Date) => value.toISOString().slice(0, 10);

export async function listInvoiceReminders(actor: CompanyContext, raw: unknown = {}) {
  const parsed = filters.safeParse(raw);
  if (!parsed.success) throw new AppError("reminders.invalid");
  const { q, page } = parsed.data, day = todayIso(), term = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
  return withCompany(actor, async tx => {
    await requireRole(tx, "sales.read"); await requireRole(tx, "ledger.read");
    const rows = await tx.$queryRaw<{ id: string; number: string; customer: string; dueDate: Date; openCents: bigint; lastReminder: Date | null }[]>`
      SELECT d.id,d.number,coalesce(d.billing_snapshot->>'name','') AS customer,d.due_date AS "dueDate",
        sales_document_open_cents(d.company_id,d.id) AS "openCents",
        (SELECT max(e.created_at) FROM invoice_email e WHERE e.company_id=d.company_id AND e.document_id=d.id AND e.purpose='REMINDER') AS "lastReminder"
      FROM sales_document d WHERE d.company_id=${actor.companyId}::uuid AND d.kind='INVOICE' AND d.status='POSTED'
        AND d.posting_date<=${day}::date AND d.due_date<${day}::date AND sales_document_open_cents(d.company_id,d.id)>0
        AND (d.number ILIKE ${term} OR coalesce(d.billing_snapshot->>'name','') ILIKE ${term})
      ORDER BY d.due_date,d.id LIMIT 51 OFFSET ${(page - 1) * 50}`;
    return { rows: rows.slice(0, 50).map(r => ({ ...r, dueDate: iso(r.dueDate), lastReminder: r.lastReminder?.toISOString() ?? null })), hasMore: rows.length > 50, page, q, asOf: day };
  });
}

async function previewWithin(tx: Tx, actor: CompanyContext, id: string, locale: "fr-CA" | "en") {
  const invoice = await tx.salesDocument.findFirst({ where: { companyId: actor.companyId, id, kind: "INVOICE", status: "POSTED" } });
  const day = todayIso();
  if (!invoice?.dueDate || iso(invoice.dueDate) >= day || iso(invoice.postingDate) > day) return null;
  const [balance] = await tx.$queryRaw<{ cents: bigint }[]>`SELECT sales_document_open_cents(${actor.companyId}::uuid,${id}::uuid) AS cents`;
  if (!balance || balance.cents <= 0n) return null;
  const previous = await tx.invoiceEmail.findFirst({ where: { companyId: actor.companyId, documentId: id, purpose: "REMINDER" }, select: { id: true } });
  const message = reminderMail({ number: invoice.number!, issuer: snapshot(invoice.issuerSnapshot, "name"), customer: snapshot(invoice.billingSnapshot, "name"), dueDate: iso(invoice.dueDate), asOf: day, outstanding: formatMoney(balance.cents, locale) }, locale);
  return { id, number: invoice.number!, customer: snapshot(invoice.billingSnapshot, "name"), recipient: snapshot(invoice.billingSnapshot, "email"), dueDate: iso(invoice.dueDate), openCents: balance.cents, asOf: day, hasReminder: Boolean(previous), message };
}

export async function getInvoiceReminder(actor: CompanyContext, id: string, locale: "fr-CA" | "en") {
  if (!z.uuid().safeParse(id).success || !["fr-CA", "en"].includes(locale)) throw new AppError("reminders.invalid");
  return withCompany(actor, async tx => {
    await requireRole(tx, "sales.read"); await requireRole(tx, "ledger.read");
    return previewWithin(tx, actor, id, locale);
  });
}

/** Reserves under the invoice lock, then performs SMTP outside the transaction. No scheduled sends. */
export async function sendInvoiceReminder(actor: CompanyContext, id: string, raw: z.input<typeof sendSchema>) {
  const parsed = sendSchema.safeParse(raw);
  if (!parsed.success || !z.uuid().safeParse(id).success) throw new AppError("reminders.invalid");
  const input = parsed.data;
  let reserved;
  try {
    reserved = await withCompany(actor, async tx => {
      await requireRole(tx, "sales.manage"); await requireRole(tx, "ledger.read");
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM sales_document WHERE company_id=${actor.companyId}::uuid AND id=${id}::uuid AND kind='INVOICE' AND status='POSTED' FOR UPDATE`;
      if (!locked[0]) throw new AppError("reminders.unavailable");
      const existing = await tx.invoiceEmail.findFirst({ where: { companyId: actor.companyId, id: input.attemptId } });
      if (existing) {
        if (existing.purpose !== "REMINDER" || existing.documentId !== id || existing.recipient !== input.recipient || existing.locale !== input.locale || String(existing.reminderCents) !== input.expectedOpenCents || (existing.reminderDate && iso(existing.reminderDate)) !== input.expectedDate) throw new AppError("reminders.invalid");
        return { existing };
      }
      const preview = await previewWithin(tx, actor, id, input.locale);
      if (!preview) throw new AppError("reminders.unavailable");
      if (String(preview.openCents) !== input.expectedOpenCents || preview.asOf !== input.expectedDate || preview.dueDate !== input.expectedDueDate) throw new AppError("reminders.stale");
      requireMailConfigured();
      const attempts = await tx.invoiceEmail.findMany({ where: { companyId: actor.companyId, documentId: id }, orderBy: { createdAt: "desc" }, take: 20 });
      if (preview.hasReminder && !input.confirmResend) throw new AppError("invoiceEmail.confirmResend");
      const now = Date.now();
      if (attempts.some(a => a.createdAt.getTime() > now - 60_000 || (a.status === "PENDING" && a.createdAt.getTime() > now - 300_000)) || attempts.filter(a => a.createdAt.getTime() > now - 86_400_000).length >= 20) throw new AppError("invoiceEmail.rate");
      const attempt = await tx.invoiceEmail.create({ data: { id: input.attemptId, companyId: actor.companyId, documentId: id, recipient: input.recipient, locale: input.locale, createdById: actor.userId, purpose: "REMINDER", reminderCents: preview.openCents, reminderDate: new Date(`${preview.asOf}T00:00:00Z`) } });
      return { attempt, message: preview.message };
    });
  } catch (error) { throw toAppError(error); }
  if (reserved.existing) return reserved.existing;
  const status = await deliverMail({ ...reserved.message!, to: input.recipient, attemptId: input.attemptId });
  try {
    return await withCompany(actor, async tx => {
      await requireRole(tx, "sales.manage"); await requireRole(tx, "ledger.read");
      return tx.invoiceEmail.update({ where: { id: input.attemptId, companyId: actor.companyId }, data: { status, completedAt: new Date() } });
    });
  } catch { throw new AppError("invoiceEmail.uncertain"); }
}

export const remindersMailConfigured = mailConfigured;
