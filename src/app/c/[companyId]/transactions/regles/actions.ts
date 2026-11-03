"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { requireSession } from "@/app/_lib/session";
import { safeAction } from "@/app/_lib/safe-action";
import { textValues, type FormState } from "@/app/_lib/form-state";
import { applyBankRule, saveBankRule, setBankRuleEnabled } from "@/modules/banking";
import { parseMoney } from "@/modules/ledger";
import { AppError } from "@/platform/errors";

export async function saveRuleAction(companyId: string, existing: { id: string; revision: number } | undefined, _previous: FormState, form: FormData): Promise<FormState> {
  const values = textValues(form, ["name", "enabled", "priority", "field", "text", "direction", "sourceAccountId", "targetAccountId", "min", "max"]);
  return safeAction(async () => {
    const session = await requireSession();
    const locale = await getLocale();
    const amount = (text: string) => {
      if (!text.trim()) return null;
      const value = parseMoney(text, locale === "en" ? "en" : "fr-CA");
      if (value === null || value <= 0n) throw new AppError("bankRules.invalid");
      return value;
    };
    if (!["true", "false"].includes(values.enabled ?? "") || !/^\d{1,5}$/.test(values.priority ?? "")) throw new AppError("bankRules.invalid");
    // The service validates the full enum and field schema again.
    const rule = await saveBankRule({ userId: session.userId, companyId }, {
      name: values.name ?? "", enabled: values.enabled === "true", priority: Number(values.priority),
      field: values.field as "PAYEE" | "DESCRIPTION", text: values.text ?? "", direction: values.direction as "ANY" | "IN" | "OUT",
      sourceAccountId: values.sourceAccountId || null, targetAccountId: values.targetAccountId ?? "",
      minCents: amount(values.min ?? ""), maxCents: amount(values.max ?? ""),
    }, existing);
    revalidatePath(`/c/${companyId}`, "layout");
    redirect(`/c/${companyId}/transactions/regles?edit=${rule.id}&saved=1`);
  }, values);
}
export async function toggleRuleAction(companyId: string, id: string, revision: number, enabled: boolean, _previous: FormState, _form: FormData): Promise<FormState> {
  return safeAction(async () => {
    const session = await requireSession();
    await setBankRuleEnabled({ userId: session.userId, companyId }, id, revision, enabled);
    revalidatePath(`/c/${companyId}`, "layout");
    return { notice: "saved" };
  });
}
export async function applyRuleAction(companyId: string, transactionId: string, ruleId: string, revision: number, _previous: FormState, _form: FormData): Promise<FormState> {
  return safeAction(async () => {
    const session = await requireSession();
    await applyBankRule({ userId: session.userId, companyId }, { transactionId, ruleId, revision });
    revalidatePath(`/c/${companyId}`, "layout");
    return { notice: "saved" };
  });
}
