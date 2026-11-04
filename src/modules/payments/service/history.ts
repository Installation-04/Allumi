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
