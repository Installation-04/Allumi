import "server-only";
import type { Prisma } from "@/platform/db";
import { AppError } from "@/platform/errors";
import type { Tx } from "@/platform/tenant";
import { billingCustomerName, paymentHistorySchema } from "../domain/history";

export function parsePaymentHistoryFilters(input: unknown = {}) {
  const result = paymentHistorySchema.safeParse(input);
  if (!result.success) throw new AppError("payments.invalidFilters");
  return result.data;
}

/** Company, direction and ledger stay outside the disjunction, including literal wildcard searches. */
export function paymentHistoryWhere(
  companyId: string,
  direction: "RECEIVED" | "SENT",
  input: unknown,
): Prisma.PaymentWhereInput {
  const { q, status, from, to } = parsePaymentHistoryFilters(input);
  const term = q.replace(/[\\%_]/g, "\\$&");
  return {
    companyId,
    direction,
    ledger: "RECEIVABLE",
    ...(status ? { status } : {}),
    ...(from || to
      ? {
          paymentDate: {
            ...(from ? { gte: new Date(`${from}T00:00:00Z`) } : {}),
            ...(to ? { lte: new Date(`${to}T00:00:00Z`) } : {}),
          },
        }
      : {}),
    ...(term
      ? {
          OR: [
            { number: { contains: term, mode: "insensitive" } },
            { reference: { contains: term, mode: "insensitive" } },
            ...(direction === "SENT" ? [{ offsetsAsSent: { some: { companyId, receivedPayment: { companyId, direction: "RECEIVED" as const, ledger: "RECEIVABLE" as const, OR: [
              { number: { contains: term, mode: "insensitive" as const } },
              { reference: { contains: term, mode: "insensitive" as const } },
              { allocations: { some: { companyId, salesDocument: { companyId, billingSnapshot: { path: ["name"], string_contains: term, mode: "insensitive" as const } } } } },
            ] } } } }] : []),
            {
              contact: { displayName: { contains: term, mode: "insensitive" } },
            },
            {
              allocations: {
                some: {
                  companyId,
                  salesDocument: {
                    companyId,
                    billingSnapshot: {
                      path: ["name"],
                      string_contains: term,
                      mode: "insensitive",
                    },
                  },
                },
              },
            },
          ],
        }
      : {}),
  };
}

type CustomerRow = {
  id: string;
  contactId: string;
  allocations: { salesDocument: { billingSnapshot: unknown } | null }[];
};
/** Prefer posted document snapshots; legacy unallocated receipts may use a visible contact without requiring it. */
export async function receiptCustomerNames(
  tx: Tx,
  companyId: string,
  rows: CustomerRow[],
) {
  const names = new Map(
    rows.map((row) => [
      row.id,
      row.allocations
        .map((a) => billingCustomerName(a.salesDocument?.billingSnapshot))
        .find(Boolean) ?? "",
    ]),
  );
  const missing = [
    ...new Set(
      rows.filter((row) => !names.get(row.id)).map((row) => row.contactId),
    ),
  ];
  if (missing.length) {
    // A separate optional lookup tolerates a Contact hidden by RLS, unlike a required Prisma relation.
    const contacts = await tx.contact.findMany({
      where: { companyId, id: { in: missing } },
      select: { id: true, displayName: true },
    });
    const visible = new Map(contacts.map((c) => [c.id, c.displayName]));
    for (const row of rows)
      if (!names.get(row.id))
        names.set(row.id, visible.get(row.contactId) ?? "");
  }
  return names;
}

/** Supplier histories use posted snapshots without requiring access to the Contacts directory. */
export async function disbursementSupplierNames(tx: Tx, companyId: string, rows: { id: string; contactId: string }[]) {
  if (!rows.length) return new Map<string, string>();
  const snapshots = await tx.$queryRaw<{ id: string; name: string }[]>`
    SELECT DISTINCT ON (a.payment_id) a.payment_id AS id, d.supplier_snapshot->>'name' AS name
      FROM payment_allocation a
      JOIN purchase_document d ON d.company_id = a.company_id AND d.id = a.purchase_document_id
     WHERE a.company_id = ${companyId}::uuid AND d.company_id = ${companyId}::uuid
       AND a.payment_id = ANY(${rows.map((row) => row.id)}::uuid[])
       AND jsonb_typeof(d.supplier_snapshot->'name') = 'string'
       AND d.supplier_snapshot->>'name' <> ''
     ORDER BY a.payment_id, a.id`;
  const names = new Map(snapshots.map((row) => [row.id, row.name]));
  const missing = [...new Set(rows.filter((row) => !names.has(row.id)).map((row) => row.contactId))];
  if (missing.length) {
    const contacts = await tx.contact.findMany({ where: { companyId, id: { in: missing } }, select: { id: true, displayName: true } });
    const visible = new Map(contacts.map((row) => [row.id, row.displayName]));
    for (const row of rows) if (!names.has(row.id)) names.set(row.id, visible.get(row.contactId) ?? "");
  }
  return names;
}

export function disbursementHistoryWhere(companyId: string, input: unknown): Prisma.PaymentWhereInput {
  const filters = parsePaymentHistoryFilters(input);
  const term = filters.q.replace(/[\\%_]/g, "\\$&");
  return {
    ...paymentHistoryWhere(companyId, "SENT", { ...filters, q: "" }),
    ledger: "PAYABLE",
    ...(term ? { OR: [
      { number: { contains: term, mode: "insensitive" } },
      { reference: { contains: term, mode: "insensitive" } },
      { contact: { companyId, displayName: { contains: term, mode: "insensitive" } } },
      { allocations: { some: { companyId, purchaseDocument: { companyId, supplierSnapshot: { path: ["name"], string_contains: term, mode: "insensitive" } } } } },
    ] } : {}),
  };
}
