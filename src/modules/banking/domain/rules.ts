import { z } from "zod";

const label = (max: number) => z.string().trim().min(1).max(max).refine(value => !/[\p{Cc}]/u.test(value));
const amount = z.bigint().min(1n).max(100_000_000_000_000n).nullable();
export const bankRuleSchema = z.object({
  name: label(120), enabled: z.boolean(), priority: z.number().int().min(0).max(10000),
  field: z.enum(["PAYEE", "DESCRIPTION"]), text: label(200), direction: z.enum(["ANY", "IN", "OUT"]),
  sourceAccountId: z.uuid().nullable(), targetAccountId: z.uuid(), minCents: amount, maxCents: amount,
}).refine(v => v.sourceAccountId !== v.targetAccountId && (v.minCents === null || v.maxCents === null || v.minCents <= v.maxCents));
export type BankRuleInput = z.infer<typeof bankRuleSchema>;
export type RuleCondition = Pick<BankRuleInput, "enabled" | "field" | "text" | "direction" | "sourceAccountId" | "minCents" | "maxCents">;
export type RuleTransaction = { accountId: string; amountCents: bigint; description: string; payee: string | null; status: string; currency: string };
/** Literal, case-insensitive Unicode matching. No regex, wildcards or floating-point amounts. */
export function ruleMatches(rule: RuleCondition, txn: RuleTransaction): boolean {
  if (!rule.enabled || txn.status !== "UNMATCHED" || txn.currency !== "CAD" || txn.amountCents === 0n) return false;
  if (rule.sourceAccountId && rule.sourceAccountId !== txn.accountId) return false;
  if ((rule.direction === "IN" && txn.amountCents < 0n) || (rule.direction === "OUT" && txn.amountCents > 0n)) return false;
  const amount = txn.amountCents < 0n ? -txn.amountCents : txn.amountCents;
  if ((rule.minCents !== null && amount < rule.minCents) || (rule.maxCents !== null && amount > rule.maxCents)) return false;
  const text = rule.field === "PAYEE" ? txn.payee ?? "" : txn.description;
  return text.normalize("NFC").toLowerCase().includes(rule.text.normalize("NFC").toLowerCase());
}
