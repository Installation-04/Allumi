import "server-only";
import { z } from "zod";
import { requireRole } from "@/modules/companies";
import { recordEvent } from "@/modules/audit";
import { AppError, toAppError } from "@/platform/errors";
import { withCompany, type CompanyContext, type Tx } from "@/platform/tenant";
import { bankRuleSchema, ruleMatches, type BankRuleInput } from "../domain/rules";
import { categorizeWithin } from "./matching";

const id = z.uuid();
const version = z.number().int().positive();
const include = { sourceAccount: { select: { id: true, code: true, nameFr: true, nameEn: true, isActive: true } }, targetAccount: { select: { id: true, code: true, nameFr: true, nameEn: true, isActive: true, type: true } } } as const;
export const MAX_BANK_RULES = 200;
export const RULE_PREVIEW_LIMIT = 500;
function validId(value: string) { if (!id.safeParse(value).success) throw new AppError("bankRules.invalid"); }
async function lockRule(tx: Tx, actor: CompanyContext, ruleId: string, revision: number) {
  validId(ruleId);
  if (!version.safeParse(revision).success) throw new AppError("bankRules.invalid");
  const rows = await tx.$queryRaw<{ id: string; revision: number }[]>`SELECT id,revision FROM bank_rule WHERE company_id=${actor.companyId}::uuid AND id=${ruleId}::uuid FOR UPDATE`;
  if (!rows[0] || rows[0].revision !== revision) throw new AppError("bankRules.stale");
}
async function accountsValid(tx: Tx, companyId: string, targetId: string, sourceId: string | null) {
  const ids = [targetId, ...(sourceId ? [sourceId] : [])];
  await tx.$queryRaw`SELECT id FROM account WHERE company_id=${companyId}::uuid AND id=ANY(${ids}::uuid[]) ORDER BY id FOR SHARE`;
  const target = await tx.account.findFirst({ where: { companyId, id: targetId, isActive: true, type: { in: ["REVENUE", "EXPENSE"] } } });
  const source = sourceId ? await tx.account.findFirst({ where: { companyId, id: sourceId, isActive: true, subtype: { in: ["CASH", "BANK", "CREDIT_CARD"] } } }) : true;
  if (!target || !source || sourceId === targetId) throw new AppError("bankRules.accounts");
}
export async function listBankRules(actor: CompanyContext) {
  return withCompany(actor, async tx => {
    await requireRole(tx, "bank.read");
    return tx.bankRule.findMany({ where: { companyId: actor.companyId }, include, orderBy: [{ priority: "asc" }, { id: "asc" }], take: MAX_BANK_RULES });
  });
}
export async function saveBankRule(actor: CompanyContext, input: BankRuleInput, existing?: { id: string; revision: number }) {
  const parsed = bankRuleSchema.safeParse(input);
  if (!parsed.success) throw new AppError("bankRules.invalid");
  return withCompany(actor, async tx => {
    await requireRole(tx, "bank.manage");
    if (existing) await lockRule(tx, actor, existing.id, existing.revision);
    else {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`bank-rule:${actor.companyId}`},0))`;
      if (await tx.bankRule.count({ where: { companyId: actor.companyId } }) >= MAX_BANK_RULES) throw new AppError("bankRules.limit");
    }
    await accountsValid(tx, actor.companyId, parsed.data.targetAccountId, parsed.data.sourceAccountId);
    return existing
      ? tx.bankRule.update({ where: { id: existing.id, companyId: actor.companyId }, data: parsed.data })
      : tx.bankRule.create({ data: { companyId: actor.companyId, ...parsed.data } });
  });
}
export async function setBankRuleEnabled(actor: CompanyContext, ruleId: string, revision: number, enabled: boolean) {
  if (typeof enabled !== "boolean") throw new AppError("bankRules.invalid");
  return withCompany(actor, async tx => {
    await requireRole(tx, "bank.manage");
    await lockRule(tx, actor, ruleId, revision);
    // Disabled rules can always be paused, even if their accounts have since been archived.
    await tx.bankRule.update({ where: { companyId: actor.companyId, id: ruleId }, data: { enabled } });
  });
}
export async function previewBankRule(actor: CompanyContext, ruleId: string) {
  validId(ruleId);
  return withCompany(actor, async tx => {
    await requireRole(tx, "bank.read");
    const rule = await tx.bankRule.findFirst({ where: { companyId: actor.companyId, id: ruleId }, include });
    if (!rule) throw new AppError("bankRules.stale");
    const rows = await tx.bankTransaction.findMany({
      where: { companyId: actor.companyId, status: "UNMATCHED", currency: "CAD", ...(rule.sourceAccountId ? { accountId: rule.sourceAccountId } : {}), account: { isActive: true, subtype: { in: ["CASH", "BANK", "CREDIT_CARD"] } } },
      orderBy: [{ txnDate: "desc" }, { id: "asc" }], take: RULE_PREVIEW_LIMIT + 1,
      select: { id: true, accountId: true, amountCents: true, description: true, payee: true, status: true, currency: true, txnDate: true },
    });
    const available = rule.targetAccount.isActive && (rule.targetAccount.type === "REVENUE" || rule.targetAccount.type === "EXPENSE") && (!rule.sourceAccount || rule.sourceAccount.isActive);
    return { rule, available, scanned: Math.min(rows.length, RULE_PREVIEW_LIMIT), limited: rows.length > RULE_PREVIEW_LIMIT, matches: available ? rows.slice(0, RULE_PREVIEW_LIMIT).filter(row => ruleMatches(rule as BankRuleInput, row)) : [] };
  });
}
export async function suggestedBankRules(actor: CompanyContext, transactionId: string) {
  validId(transactionId);
  return withCompany(actor, async tx => {
    await requireRole(tx, "bank.read");
    const txn = await tx.bankTransaction.findFirst({ where: { companyId: actor.companyId, id: transactionId, account: { isActive: true, subtype: { in: ["CASH", "BANK", "CREDIT_CARD"] } } } });
    if (!txn) return [];
    const rules = await tx.bankRule.findMany({ where: { companyId: actor.companyId, enabled: true, targetAccount: { isActive: true, type: { in: ["REVENUE", "EXPENSE"] } } }, include, orderBy: [{ priority: "asc" }, { id: "asc" }], take: MAX_BANK_RULES });
    return rules.filter(rule => ruleMatches(rule as BankRuleInput, txn));
  });
}
/** Locks the rule and statement line in the same transaction as posting; no stale browser decision can post. */
export async function applyBankRule(actor: CompanyContext, input: { ruleId: string; revision: number; transactionId: string }) {
  validId(input.transactionId);
  try {
    return await withCompany(actor, async tx => {
      await requireRole(tx, "bank.manage");
      await requireRole(tx, "entry.post");
      await lockRule(tx, actor, input.ruleId, input.revision);
      await tx.$queryRaw`SELECT id FROM bank_transaction WHERE company_id=${actor.companyId}::uuid AND id=${input.transactionId}::uuid FOR UPDATE`;
      const [rule, txn] = await Promise.all([
        tx.bankRule.findFirst({ where: { companyId: actor.companyId, id: input.ruleId } }),
        tx.bankTransaction.findFirst({ where: { companyId: actor.companyId, id: input.transactionId } }),
      ]);
      if (!rule || !txn || !ruleMatches(rule as BankRuleInput, txn)) throw new AppError("bankRules.stale");
      await accountsValid(tx, actor.companyId, rule.targetAccountId, txn.accountId);
      const result = await categorizeWithin(tx, actor, txn.id, { accountId: rule.targetAccountId });
      await recordEvent(tx, { action: "bank_rule.apply", entityType: "bank_transaction", entityId: txn.id, data: { ruleId: rule.id, revision: rule.revision, entryId: result.entryId } });
      return result;
    });
  } catch (error) { throw toAppError(error); }
}
