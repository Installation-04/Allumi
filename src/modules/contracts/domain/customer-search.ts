export const CONTRACT_CUSTOMER_LIMIT = 20;
export type ContractCustomerChoice = { id: string; displayName: string; email: string | null };
export function contractCustomerQuery(value: unknown): string {
  if (typeof value !== "string" || /[\p{Cc}]/u.test(value)) throw new RangeError("customer query");
  const q = value.trim(), size = [...q].length;
  if (size < 2 || size > 100) throw new RangeError("customer query");
  return q;
}
