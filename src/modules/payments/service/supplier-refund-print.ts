import "server-only";
import { requireRole } from "@/modules/companies";
import { AppError } from "@/platform/errors";
import { withCompany, type CompanyContext } from "@/platform/tenant";
import { disbursementSupplierNames } from "./history";

export const SUPPLIER_REFUND_PRINT_LIMIT = 1_000;
const iso = (date: Date) => date.toISOString().slice(0, 10);

/** A public-field accounting copy, never the private detail DTO or a page of its origins. */
export async function getSupplierRefundPrintDocument(actor: CompanyContext, id: string, options: { maxOrigins?: number } = {}) {
  return withCompany(actor, async tx => {
    await requireRole(tx, "ledger.read");
    const limit = options.maxOrigins ?? SUPPLIER_REFUND_PRINT_LIMIT;
    if (!Number.isInteger(limit) || limit < 0 || limit > SUPPLIER_REFUND_PRINT_LIMIT) throw new AppError("payments.invalidFilters");
    // Cancellation locks the payment before changing its origins. Keep one consistent copy.
    await tx.$queryRaw`SELECT id FROM payment WHERE company_id=${actor.companyId}::uuid AND id=${id}::uuid AND direction='RECEIVED' AND ledger='PAYABLE' FOR SHARE`;
    const payment = await tx.payment.findFirst({
      where: { companyId: actor.companyId, id, direction: "RECEIVED", ledger: "PAYABLE" },
      select: {
        id: true, contactId: true, number: true, paymentDate: true, amountCents: true, status: true, method: true, reference: true,
        voidEntry: { select: { entryDate: true } },
        allocations: {
          where: { companyId: actor.companyId },
          select: { amountCents: true, appliedDate: true, unappliedDate: true, purchaseDocument: { select: { number: true } } },
          orderBy: [{ appliedDate: "asc" }, { id: "asc" }], take: limit + 1,
        },
      },
    });
    if (!payment) return null;
    if (payment.allocations.length > limit) throw new AppError("supplierRefunds.printLimit");
    const names = await disbursementSupplierNames(tx, actor.companyId, [payment]);
    return {
      number: payment.number ?? "", date: iso(payment.paymentDate), amountCents: payment.amountCents,
      status: payment.status, method: payment.method, reference: payment.reference, supplier: names.get(payment.id) ?? "",
      voidDate: payment.voidEntry ? iso(payment.voidEntry.entryDate) : null,
      origins: payment.allocations.map(row => ({
        number: row.purchaseDocument?.number ?? "", amountCents: row.amountCents,
        appliedDate: iso(row.appliedDate), unappliedDate: row.unappliedDate ? iso(row.unappliedDate) : null,
      })),
    };
  });
}
