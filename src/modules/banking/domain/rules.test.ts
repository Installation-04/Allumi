import { describe, expect, it } from "vitest";
import { bankRuleSchema, ruleMatches, type BankRuleInput, type RuleTransaction } from "./rules";
const rule: BankRuleInput = { name: "Abonnement", enabled: true, priority: 100, field: "DESCRIPTION", text: "Café %_", direction: "OUT", sourceAccountId: null, targetAccountId: "00000000-0000-7000-8000-00000000a500", minCents: 100n, maxCents: 200n };
const txn: RuleTransaction = { accountId: "bank", amountCents: -150n, description: "CAFÉ %_ abonnement", payee: null, currency: "CAD", status: "UNMATCHED" };
describe("literal rule conditions", () => {
 it("matches Unicode composed/decomposed text without treating percent or underscore as wildcards", () => {
  expect(ruleMatches(rule, txn)).toBe(true);
  expect(ruleMatches(rule, { ...txn, description: "Cafe\u0301 %_" })).toBe(true);
  expect(ruleMatches(rule, { ...txn, description: "Café xyz" })).toBe(false);
 });
 it("uses exact inclusive absolute limits", () => {
  for (const amountCents of [-100n,-200n]) expect(ruleMatches(rule, {...txn,amountCents})).toBe(true);
  for (const amountCents of [-99n,-201n,100n,0n]) expect(ruleMatches(rule, {...txn,amountCents})).toBe(false);
  expect(ruleMatches({...rule,direction:"ANY",minCents:99_999_999_999_999n,maxCents:100_000_000_000_000n},{...txn,amountCents:99_999_999_999_999n})).toBe(true);
 });
 it("ignores disabled, foreign currency, excluded, matched and wrong bank transactions", () => {
  expect(ruleMatches({...rule,enabled:false},txn)).toBe(false);
  expect(ruleMatches({...rule,sourceAccountId:"other"},txn)).toBe(false);
  for (const status of ["EXCLUDED","MATCHED"]) expect(ruleMatches(rule,{...txn,status})).toBe(false);
  expect(ruleMatches(rule,{...txn,currency:"USD"})).toBe(false);
 });
 it("matches only the requested field", () => {
  expect(ruleMatches({...rule,field:"PAYEE"},txn)).toBe(false);
  expect(ruleMatches({...rule,field:"PAYEE"},{...txn,payee:"Café %_"})).toBe(true);
 });
 it("rejects ambiguous or unbounded configuration", () => {
  for(const changes of [{text:" "},{text:"bad\ntext"},{priority:0.5},{minCents:201n},{maxCents:100_000_000_000_001n},{sourceAccountId:rule.targetAccountId}]) expect(bankRuleSchema.safeParse({...rule,...changes}).success).toBe(false);
 });
});
