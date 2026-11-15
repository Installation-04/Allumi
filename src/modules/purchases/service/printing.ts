import "server-only";
import { requireRole } from "@/modules/companies";
import { withCompany, type CompanyContext } from "@/platform/tenant";
import { purchaseTaxLabels } from "./tax-labels";

const identityFields = ["name", "legalName", "addressLine1", "addressLine2", "city", "province", "postalCode", "country", "gstNumber", "qstNumber"] as const;

/** A whitelist projection: notes, void reasons, contact links and attachments never enter the print payload. */
export async function getPurchasePrintDocument(actor: CompanyContext, id: string, kind: "BILL" | "SUPPLIER_CREDIT") {
  return withCompany(actor, async tx => {
    await requireRole(tx, "ledger.read");
    const row = await tx.purchaseDocument.findFirst({
      where: { companyId: actor.companyId, id, kind, status: { in: ["POSTED", "VOID"] } },
      select: {
        number: true, status: true, documentDate: true, postingDate: true, dueDate: true, supplierReference: true,
        supplierSnapshot: true, subtotalCents: true, totalCents: true,
        voidEntry: { select: { entryDate: true } }, creditedDocument: { select: { number: true } },
        lines: { orderBy: { position: "asc" }, select: { position: true, description: true, quantity: true, unitPrice: true, amountCents: true } },
        taxes: { orderBy: { taxId: "asc" }, select: { taxId: true, amountCents: true } },
      },
    });
    if (!row) return null;
    const snapshot = row.supplierSnapshot && typeof row.supplierSnapshot === "object" && !Array.isArray(row.supplierSnapshot) ? row.supplierSnapshot : {};
    const taxes = await purchaseTaxLabels(tx, actor.companyId, row.taxes);
    const iso = (date: Date) => date.toISOString().slice(0, 10);
    return {
      kind, number: row.number ?? "", status: row.status, date: iso(row.documentDate), postingDate: iso(row.postingDate),
      dueDate: row.dueDate ? iso(row.dueDate) : null, reference: row.supplierReference,
      supplier: identityFields.flatMap(key => typeof snapshot[key] === "string" && snapshot[key] ? [snapshot[key] as string] : []),
      voidDate: row.voidEntry ? iso(row.voidEntry.entryDate) : null, sourceNumber: row.creditedDocument?.number ?? null,
      subtotalCents: row.subtotalCents, totalCents: row.totalCents,
      lines: row.lines.map(line => ({ position: line.position, description: line.description, quantity: line.quantity.toString(), unitPrice: line.unitPrice.toString(), amountCents: line.amountCents })),
      taxes: taxes.map(tax => ({ code: tax.tax?.code ?? null, amountCents: tax.amountCents })),
    };
  });
}
