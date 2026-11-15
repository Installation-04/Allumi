import "server-only";
import type { Tx } from "@/platform/tenant";

/** Amounts belong to the posted document; directory labels are optional and respect Tax RLS. */
export async function purchaseTaxLabels<T extends { taxId: string }>(tx: Tx, companyId: string, taxes: T[]) {
  const ids = [...new Set(taxes.map(row => row.taxId))];
  const visible = ids.length ? await tx.tax.findMany({ where: { companyId, id: { in: ids } }, select: { id: true, code: true } }) : [];
  const codes = new Map(visible.map(row => [row.id, row.code]));
  return taxes.map(row => ({ ...row, tax: codes.has(row.taxId) ? { code: codes.get(row.taxId)! } : null }));
}
