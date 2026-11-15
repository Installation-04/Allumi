import "server-only";
import { requireRole } from "@/modules/companies";
import { isValidIsoDate, todayIso } from "@/modules/ledger";
import { AppError, toAppError } from "@/platform/errors";
import { withCompany, type CompanyContext, type Tx } from "@/platform/tenant";
import { supplierCreditApplicationSchema, supplierCreditUnapplicationSchema } from "../domain/application";

export const SUPPLIER_CREDIT_TARGET_LIMIT = 50;
const iso = (date: Date) => date.toISOString().slice(0, 10);
const validId = (id: string) => supplierCreditApplicationSchema.shape.supplierCreditId.safeParse(id).success;

/** Source and target bills precede their credit, matching posting and credit voiding. */
async function lockDocuments(tx: Tx, actor: CompanyContext, supplierCreditId: string, billId: string) {
  const reference = await tx.purchaseDocument.findFirst({
    where: { companyId: actor.companyId, id: supplierCreditId, kind: "SUPPLIER_CREDIT" },
    select: { creditedDocumentId: true },
  });
  if (!reference?.creditedDocumentId) throw new AppError("supplierApplications.creditNotFound");
  const sourceId = reference.creditedDocumentId;
  await tx.$queryRaw`SELECT id FROM purchase_document WHERE company_id=${actor.companyId}::uuid AND kind='BILL' AND (id=${sourceId}::uuid OR id=${billId}::uuid) ORDER BY id FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM purchase_document WHERE company_id=${actor.companyId}::uuid AND id=${supplierCreditId}::uuid AND kind='SUPPLIER_CREDIT' FOR UPDATE`;
  const credit = await tx.purchaseDocument.findFirst({
    where: { companyId: actor.companyId, id: supplierCreditId, kind: "SUPPLIER_CREDIT" },
    select: { id: true, status: true, contactId: true, creditedDocumentId: true, postingDate: true },
  });
  const bill = await tx.purchaseDocument.findFirst({
    where: { companyId: actor.companyId, id: billId, kind: "BILL" },
    select: { id: true, status: true, contactId: true, postingDate: true },
  });
  if (!credit || credit.creditedDocumentId !== sourceId) throw new AppError("supplierApplications.creditNotFound");
  if (!bill) throw new AppError("supplierApplications.billNotFound");
  if (credit.contactId !== bill.contactId) throw new AppError("supplierApplications.supplierMismatch");
  return { credit, bill };
}

/** A settlement is never backdated before availability was restored on either document. */
async function checkDate(tx: Tx, actor: CompanyContext, supplierCreditId: string, billId: string, date: string, notBefore: string) {
  if (date < notBefore) throw new AppError("supplierApplications.dateBeforeDocuments");
  const history = await tx.$queryRaw<{ latest: Date | null }[]>`
    SELECT max(d) AS latest FROM (
      SELECT applied_date AS d FROM payment_allocation WHERE company_id=${actor.companyId}::uuid AND (purchase_document_id=${supplierCreditId}::uuid OR purchase_document_id=${billId}::uuid)
      UNION ALL SELECT unapplied_date FROM payment_allocation WHERE company_id=${actor.companyId}::uuid AND (purchase_document_id=${supplierCreditId}::uuid OR purchase_document_id=${billId}::uuid)
      UNION ALL SELECT applied_date FROM purchase_credit_application WHERE company_id=${actor.companyId}::uuid AND (supplier_credit_id=${supplierCreditId}::uuid OR bill_id=${billId}::uuid)
      UNION ALL SELECT unapplied_date FROM purchase_credit_application WHERE company_id=${actor.companyId}::uuid AND (supplier_credit_id=${supplierCreditId}::uuid OR bill_id=${billId}::uuid)
    ) movements`;
  if (history[0]?.latest && date < iso(history[0].latest)) throw new AppError("supplierApplications.dateBeforeMovement");
  // Match journal insertion: a concurrent period closure waits until this settlement commits.
  const periods = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM fiscal_period WHERE company_id=${actor.companyId}::uuid AND ${date}::date BETWEEN start_date AND end_date FOR SHARE`;
  if (periods.length !== 1 || periods[0]?.status !== "OPEN") throw new AppError("supplierApplications.periodClosed");
}

/** Apply a supplier credit without a second journal entry: both source entries already affect payables. */
export async function applySupplierCredit(actor: CompanyContext, input: unknown, options: { now?: Date } = {}): Promise<{ id: string }> {
  const parsed = supplierCreditApplicationSchema.safeParse(input);
  if (!parsed.success || !isValidIsoDate(parsed.data.date)) throw new AppError("supplierApplications.invalid");
  const { supplierCreditId, billId, amountCents, expectedCreditCents, expectedBillCents, date } = parsed.data;
  if (date > todayIso(options.now)) throw new AppError("supplierApplications.futureDate");
  try {
    return await withCompany(actor, async tx => {
      await requireRole(tx, "entry.post");
      const { credit, bill } = await lockDocuments(tx, actor, supplierCreditId, billId);
      if (credit.status !== "POSTED" || bill.status !== "POSTED") throw new AppError("supplierApplications.notPosted");
      await checkDate(tx, actor, supplierCreditId, billId, date, iso(credit.postingDate) > iso(bill.postingDate) ? iso(credit.postingDate) : iso(bill.postingDate));
      const balances = await tx.$queryRaw<{ credit: bigint; bill: bigint }[]>`SELECT purchase_document_open_cents(${actor.companyId}::uuid,${supplierCreditId}::uuid) AS credit,purchase_document_open_cents(${actor.companyId}::uuid,${billId}::uuid) AS bill`;
      if (!balances[0] || balances[0].credit !== expectedCreditCents || balances[0].bill !== expectedBillCents) throw new AppError("supplierApplications.stale");
      if (amountCents > balances[0].credit || amountCents > balances[0].bill) throw new AppError("supplierApplications.exceeds");
      const active = await tx.purchaseCreditApplication.findFirst({ where: { companyId: actor.companyId, supplierCreditId, billId, unappliedDate: null }, select: { id: true } });
      if (active) throw new AppError("supplierApplications.alreadyApplied");
      const application = await tx.purchaseCreditApplication.create({ data: { companyId: actor.companyId, supplierCreditId, billId, amountCents, appliedDate: new Date(`${date}T00:00:00Z`), createdById: actor.userId }, select: { id: true } });
      await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
      return application;
    });
  } catch (error) { throw toAppError(error); }
}

/** Release the link through a dated history event; the original application remains immutable. */
export async function unapplySupplierCredit(actor: CompanyContext, applicationId: string, input: unknown, options: { now?: Date } = {}): Promise<string> {
  const parsed = supplierCreditUnapplicationSchema.safeParse(input);
  if (!validId(applicationId) || !parsed.success || !isValidIsoDate(parsed.data.date)) throw new AppError("supplierApplications.invalid");
  const { date } = parsed.data;
  if (date > todayIso(options.now)) throw new AppError("supplierApplications.futureDate");
  try {
    return await withCompany(actor, async tx => {
      await requireRole(tx, "entry.post");
      const reference = await tx.purchaseCreditApplication.findFirst({ where: { companyId: actor.companyId, id: applicationId }, select: { supplierCreditId: true, billId: true } });
      if (!reference) throw new AppError("supplierApplications.applicationNotFound");
      const { credit, bill } = await lockDocuments(tx, actor, reference.supplierCreditId, reference.billId);
      await tx.$queryRaw`SELECT id FROM purchase_credit_application WHERE company_id=${actor.companyId}::uuid AND id=${applicationId}::uuid FOR UPDATE`;
      const application = await tx.purchaseCreditApplication.findFirstOrThrow({ where: { companyId: actor.companyId, id: applicationId } });
      // Repeated submissions never move a historical release to another date.
      if (application.unappliedDate) return application.id;
      if (credit.status !== "POSTED" || bill.status !== "POSTED") throw new AppError("supplierApplications.notPosted");
      await checkDate(tx, actor, credit.id, bill.id, date, iso(application.appliedDate));
      await tx.purchaseCreditApplication.update({ where: { companyId: actor.companyId, id: applicationId }, data: { unappliedDate: new Date(`${date}T00:00:00Z`), unappliedById: actor.userId } });
      await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
      return application.id;
    });
  } catch (error) { throw toAppError(error); }
}

/** Bounded picker using immutable purchase fields; contact-module visibility is not required. */
export async function listSupplierCreditTargets(actor: CompanyContext, supplierCreditId: string, q = "") {
  if (!validId(supplierCreditId) || typeof q !== "string" || q.length > 100 || /[\u0000-\u001f\u007f]/.test(q)) throw new AppError("supplierApplications.invalid");
  return withCompany(actor, async tx => {
    await requireRole(tx, "ledger.read");
    const credit = await tx.purchaseDocument.findFirst({ where: { companyId: actor.companyId, id: supplierCreditId, kind: "SUPPLIER_CREDIT", status: "POSTED" }, select: { contactId: true } });
    if (!credit) throw new AppError("supplierApplications.creditNotFound");
    const pattern = `%${q.trim().replace(/[\\%_]/g, value => `\\${value}`)}%`;
    const rows = await tx.$queryRaw<{ id: string; number: string; date: Date; totalCents: bigint; openCents: bigint }[]>`
      SELECT id,number,posting_date AS date,total_cents AS "totalCents",purchase_document_open_cents(company_id,id) AS "openCents"
      FROM purchase_document WHERE company_id=${actor.companyId}::uuid AND contact_id=${credit.contactId}::uuid AND kind='BILL' AND status='POSTED'
        AND (number ILIKE ${pattern} OR coalesce(supplier_reference,'') ILIKE ${pattern})
        AND purchase_document_open_cents(company_id,id)>0
        AND NOT EXISTS (SELECT 1 FROM purchase_credit_application a WHERE a.company_id=purchase_document.company_id AND a.supplier_credit_id=${supplierCreditId}::uuid AND a.bill_id=purchase_document.id AND a.unapplied_date IS NULL)
      ORDER BY posting_date DESC,number DESC,id DESC LIMIT ${SUPPLIER_CREDIT_TARGET_LIMIT + 1}`;
    return { bills: rows.slice(0, SUPPLIER_CREDIT_TARGET_LIMIT).map(row => ({ ...row, date: iso(row.date) })), hasMore: rows.length > SUPPLIER_CREDIT_TARGET_LIMIT };
  });
}

export const SUPPLIER_APPLICATIONS_PER_PAGE = 25;

/** Dated releases remain visible alongside active applications, with a bounded page size. */
export async function listSupplierCreditApplications(actor: CompanyContext, supplierCreditId: string, requestedPage = 1) {
  if (!validId(supplierCreditId)) throw new AppError("supplierApplications.invalid");
  return withCompany(actor, async tx => {
    await requireRole(tx, "ledger.read");
    const credit = await tx.purchaseDocument.findFirst({ where: { companyId: actor.companyId, id: supplierCreditId, kind: "SUPPLIER_CREDIT", status: { in: ["POSTED", "VOID"] } }, select: { id: true } });
    if (!credit) throw new AppError("supplierApplications.creditNotFound");
    const where = { companyId: actor.companyId, supplierCreditId };
    const total = await tx.purchaseCreditApplication.count({ where });
    const pageCount = Math.max(1, Math.ceil(total / SUPPLIER_APPLICATIONS_PER_PAGE));
    const page = Math.min(Math.max(1, Number.isFinite(requestedPage) ? Math.trunc(requestedPage) : 1), pageCount);
    const rows = await tx.purchaseCreditApplication.findMany({ where, select: { id: true, billId: true, amountCents: true, appliedDate: true, unappliedDate: true, bill: { select: { number: true } } }, orderBy: [{ appliedDate: "desc" }, { id: "desc" }], skip: (page - 1) * SUPPLIER_APPLICATIONS_PER_PAGE, take: SUPPLIER_APPLICATIONS_PER_PAGE });
    return { applications: rows.map(row => ({ id: row.id, billId: row.billId, billNumber: row.bill.number ?? "", amountCents: row.amountCents, appliedDate: iso(row.appliedDate), unappliedDate: row.unappliedDate ? iso(row.unappliedDate) : null })), total, page, pageCount };
  });
}
