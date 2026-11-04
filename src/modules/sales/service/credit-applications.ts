import "server-only";
import { requireRole } from "@/modules/companies";
import { isValidIsoDate, todayIso } from "@/modules/ledger";
import { AppError, toAppError } from "@/platform/errors";
import { withCompany, type CompanyContext, type Tx } from "@/platform/tenant";
import { customerCreditApplicationSchema, customerCreditUnapplicationSchema } from "../domain/application";

export const CREDIT_APPLICATION_TARGET_LIMIT = 50;
const iso = (date: Date) => date.toISOString().slice(0, 10);
const validId = (id: string) => customerCreditApplicationSchema.shape.creditNoteId.safeParse(id).success;

/** Source and target invoices precede their credit, matching posting and credit voiding. */
async function lockDocuments(tx: Tx, actor: CompanyContext, creditNoteId: string, invoiceId: string) {
  const reference = await tx.salesDocument.findFirst({
    where: { companyId: actor.companyId, id: creditNoteId, kind: "CREDIT_NOTE" },
    select: { creditedDocumentId: true },
  });
  if (!reference?.creditedDocumentId) throw new AppError("salesApplications.creditNotFound");
  const sourceId = reference.creditedDocumentId;
  await tx.$queryRaw`SELECT id FROM sales_document WHERE company_id=${actor.companyId}::uuid AND kind='INVOICE' AND (id=${sourceId}::uuid OR id=${invoiceId}::uuid) ORDER BY id FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM sales_document WHERE company_id=${actor.companyId}::uuid AND id=${creditNoteId}::uuid AND kind='CREDIT_NOTE' FOR UPDATE`;
  const credit = await tx.salesDocument.findFirst({
    where: { companyId: actor.companyId, id: creditNoteId, kind: "CREDIT_NOTE" },
    select: { id: true, status: true, contactId: true, creditedDocumentId: true, postingDate: true },
  });
  const invoice = await tx.salesDocument.findFirst({
    where: { companyId: actor.companyId, id: invoiceId, kind: "INVOICE" },
    select: { id: true, status: true, contactId: true, postingDate: true },
  });
  if (!credit || credit.creditedDocumentId !== sourceId) throw new AppError("salesApplications.creditNotFound");
  if (!invoice) throw new AppError("salesApplications.invoiceNotFound");
  if (credit.contactId !== invoice.contactId) throw new AppError("salesApplications.customerMismatch");
  return { credit, invoice };
}

/** A settlement is never backdated before availability was restored on either document. */
async function checkDate(tx: Tx, actor: CompanyContext, creditNoteId: string, invoiceId: string, date: string, notBefore: string) {
  if (date < notBefore) throw new AppError("salesApplications.dateBeforeDocuments");
  const history = await tx.$queryRaw<{ latest: Date | null }[]>`
    SELECT max(d) AS latest FROM (
      SELECT applied_date AS d FROM payment_allocation WHERE company_id=${actor.companyId}::uuid AND (sales_document_id=${creditNoteId}::uuid OR sales_document_id=${invoiceId}::uuid)
      UNION ALL SELECT unapplied_date FROM payment_allocation WHERE company_id=${actor.companyId}::uuid AND (sales_document_id=${creditNoteId}::uuid OR sales_document_id=${invoiceId}::uuid)
      UNION ALL SELECT applied_date FROM sales_credit_application WHERE company_id=${actor.companyId}::uuid AND (credit_note_id=${creditNoteId}::uuid OR invoice_id=${invoiceId}::uuid)
      UNION ALL SELECT unapplied_date FROM sales_credit_application WHERE company_id=${actor.companyId}::uuid AND (credit_note_id=${creditNoteId}::uuid OR invoice_id=${invoiceId}::uuid)
    ) movements`;
  if (history[0]?.latest && date < iso(history[0].latest)) throw new AppError("salesApplications.dateBeforeMovement");
  // Match journal insertion: a concurrent period closure waits until this settlement commits.
  const periods = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM fiscal_period WHERE company_id=${actor.companyId}::uuid AND ${date}::date BETWEEN start_date AND end_date FOR SHARE`;
  if (periods.length !== 1 || periods[0]?.status !== "OPEN") throw new AppError("salesApplications.periodClosed");
}

/** Apply a customer credit without a second journal entry: both source entries already affect receivables. */
export async function applyCustomerCredit(actor: CompanyContext, input: unknown, options: { now?: Date } = {}): Promise<{ id: string }> {
  const parsed = customerCreditApplicationSchema.safeParse(input);
  if (!parsed.success || !isValidIsoDate(parsed.data.date)) throw new AppError("salesApplications.invalid");
  const { creditNoteId, invoiceId, amountCents, expectedCreditCents, expectedInvoiceCents, date } = parsed.data;
  if (date > todayIso(options.now)) throw new AppError("salesApplications.futureDate");
  try {
    return await withCompany(actor, async tx => {
      await requireRole(tx, "sales.manage");
      await requireRole(tx, "entry.post");
      const { credit, invoice } = await lockDocuments(tx, actor, creditNoteId, invoiceId);
      if (credit.status !== "POSTED" || invoice.status !== "POSTED") throw new AppError("salesApplications.notPosted");
      await checkDate(tx, actor, creditNoteId, invoiceId, date, iso(credit.postingDate) > iso(invoice.postingDate) ? iso(credit.postingDate) : iso(invoice.postingDate));
      const balances = await tx.$queryRaw<{ credit: bigint; invoice: bigint }[]>`SELECT sales_document_open_cents(${actor.companyId}::uuid,${creditNoteId}::uuid) AS credit,sales_document_open_cents(${actor.companyId}::uuid,${invoiceId}::uuid) AS invoice`;
      if (!balances[0] || balances[0].credit !== expectedCreditCents || balances[0].invoice !== expectedInvoiceCents) throw new AppError("salesApplications.stale");
      if (amountCents > balances[0].credit || amountCents > balances[0].invoice) throw new AppError("salesApplications.exceeds");
      const active = await tx.salesCreditApplication.findFirst({ where: { companyId: actor.companyId, creditNoteId, invoiceId, unappliedDate: null }, select: { id: true } });
      if (active) throw new AppError("salesApplications.alreadyApplied");
      const application = await tx.salesCreditApplication.create({ data: { companyId: actor.companyId, creditNoteId, invoiceId, amountCents, appliedDate: new Date(`${date}T00:00:00Z`), createdById: actor.userId }, select: { id: true } });
      await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
      return application;
    });
  } catch (error) { throw toAppError(error); }
}

/** Release the link through a dated history event; the original application remains immutable. */
export async function unapplyCustomerCredit(actor: CompanyContext, applicationId: string, input: unknown, options: { now?: Date } = {}): Promise<string> {
  const parsed = customerCreditUnapplicationSchema.safeParse(input);
  if (!validId(applicationId) || !parsed.success || !isValidIsoDate(parsed.data.date)) throw new AppError("salesApplications.invalid");
  const { date } = parsed.data;
  if (date > todayIso(options.now)) throw new AppError("salesApplications.futureDate");
  try {
    return await withCompany(actor, async tx => {
      await requireRole(tx, "sales.manage");
      await requireRole(tx, "entry.post");
      const reference = await tx.salesCreditApplication.findFirst({ where: { companyId: actor.companyId, id: applicationId }, select: { creditNoteId: true, invoiceId: true } });
      if (!reference) throw new AppError("salesApplications.applicationNotFound");
      const { credit, invoice } = await lockDocuments(tx, actor, reference.creditNoteId, reference.invoiceId);
      await tx.$queryRaw`SELECT id FROM sales_credit_application WHERE company_id=${actor.companyId}::uuid AND id=${applicationId}::uuid FOR UPDATE`;
      const application = await tx.salesCreditApplication.findFirstOrThrow({ where: { companyId: actor.companyId, id: applicationId } });
      // Repeated submissions never move a historical release to another date.
      if (application.unappliedDate) return application.id;
      if (credit.status !== "POSTED" || invoice.status !== "POSTED") throw new AppError("salesApplications.notPosted");
      await checkDate(tx, actor, credit.id, invoice.id, date, iso(application.appliedDate));
      await tx.salesCreditApplication.update({ where: { companyId: actor.companyId, id: applicationId }, data: { unappliedDate: new Date(`${date}T00:00:00Z`), unappliedById: actor.userId } });
      await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
      return application.id;
    });
  } catch (error) { throw toAppError(error); }
}

/** Bounded picker using immutable sales fields; contact-module visibility is not required. */
export async function listCreditApplicationTargets(actor: CompanyContext, creditNoteId: string, q = "") {
  if (!validId(creditNoteId) || typeof q !== "string" || q.length > 100 || /[\u0000-\u001f\u007f]/.test(q)) throw new AppError("salesApplications.invalid");
  return withCompany(actor, async tx => {
    await requireRole(tx, "sales.read");
    await requireRole(tx, "ledger.read");
    const credit = await tx.salesDocument.findFirst({ where: { companyId: actor.companyId, id: creditNoteId, kind: "CREDIT_NOTE", status: "POSTED" }, select: { contactId: true } });
    if (!credit) throw new AppError("salesApplications.creditNotFound");
    const pattern = `%${q.trim().replace(/[\\%_]/g, value => `\\${value}`)}%`;
    const rows = await tx.$queryRaw<{ id: string; number: string; date: Date; totalCents: bigint; openCents: bigint }[]>`
      SELECT id,number,posting_date AS date,total_cents AS "totalCents",sales_document_open_cents(company_id,id) AS "openCents"
      FROM sales_document WHERE company_id=${actor.companyId}::uuid AND contact_id=${credit.contactId}::uuid AND kind='INVOICE' AND status='POSTED'
        AND (number ILIKE ${pattern} OR coalesce(reference,'') ILIKE ${pattern})
        AND sales_document_open_cents(company_id,id)>0
        AND NOT EXISTS (SELECT 1 FROM sales_credit_application a WHERE a.company_id=sales_document.company_id AND a.credit_note_id=${creditNoteId}::uuid AND a.invoice_id=sales_document.id AND a.unapplied_date IS NULL)
      ORDER BY posting_date DESC,number DESC,id DESC LIMIT ${CREDIT_APPLICATION_TARGET_LIMIT + 1}`;
    return { invoices: rows.slice(0, CREDIT_APPLICATION_TARGET_LIMIT).map(row => ({ ...row, date: iso(row.date) })), hasMore: rows.length > CREDIT_APPLICATION_TARGET_LIMIT };
  });
}

export const APPLICATIONS_PER_PAGE = 25;

/** Dated releases remain visible alongside active applications, with a bounded page size. */
export async function listCreditApplications(actor: CompanyContext, creditNoteId: string, requestedPage = 1) {
  if (!validId(creditNoteId)) throw new AppError("salesApplications.invalid");
  return withCompany(actor, async tx => {
    await requireRole(tx, "sales.read");
    await requireRole(tx, "ledger.read");
    const credit = await tx.salesDocument.findFirst({ where: { companyId: actor.companyId, id: creditNoteId, kind: "CREDIT_NOTE", status: { in: ["POSTED", "VOID"] } }, select: { id: true } });
    if (!credit) throw new AppError("salesApplications.creditNotFound");
    const where = { companyId: actor.companyId, creditNoteId };
    const total = await tx.salesCreditApplication.count({ where });
    const pageCount = Math.max(1, Math.ceil(total / APPLICATIONS_PER_PAGE));
    const page = Math.min(Math.max(1, Number.isFinite(requestedPage) ? Math.trunc(requestedPage) : 1), pageCount);
    const rows = await tx.salesCreditApplication.findMany({ where, select: { id: true, invoiceId: true, amountCents: true, appliedDate: true, unappliedDate: true, invoice: { select: { number: true } } }, orderBy: [{ appliedDate: "desc" }, { id: "desc" }], skip: (page - 1) * APPLICATIONS_PER_PAGE, take: APPLICATIONS_PER_PAGE });
    return { applications: rows.map(row => ({ id: row.id, invoiceId: row.invoiceId, invoiceNumber: row.invoice.number ?? "", amountCents: row.amountCents, appliedDate: iso(row.appliedDate), unappliedDate: row.unappliedDate ? iso(row.unappliedDate) : null })), total, page, pageCount };
  });
}
