"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { requireSession } from "@/app/_lib/session";
import { safeAction } from "@/app/_lib/safe-action";
import type { FormState } from "@/app/_lib/form-state";
import { AppError } from "@/platform/errors";
import { parseMoney, postManualEntry, reverseEntry, type Locale } from "@/modules/ledger";

/** An empty box is zero; text that is not an amount (or has sub-cent decimals) is refused. */
function amount(value: string | undefined, locale: Locale): bigint {
  if (value === undefined || value.trim() === "") return 0n;
  const cents = parseMoney(value, locale);
  if (cents === null) throw new AppError("ledger.invalidAmount");
  return cents;
}

export async function postEntryAction(companyId: string, _previous: FormState, formData: FormData): Promise<FormState> {
  return safeAction(async () => {
    const session = await requireSession();
    const locale: Locale = (await getLocale()) === "en" ? "en" : "fr-CA";
    const [accounts, debits, credits, notes] = ["lineAccount", "lineDebit", "lineCredit", "lineNote"].map((name) => formData.getAll(name).map(String));
    const lines = (accounts ?? [])
      .map((accountId, index) => ({
        accountId,
        debitCents: amount(debits?.[index], locale),
        creditCents: amount(credits?.[index], locale),
        description: notes?.[index]?.trim() || null,
      }))
      // a row left completely blank is not a line
      .filter((line) => line.accountId !== "" || line.debitCents !== 0n || line.creditCents !== 0n);
    const kind = formData.get("kind") === "OPENING_BALANCE" ? "OPENING_BALANCE" : "MANUAL";
    const memo = String(formData.get("memo") ?? "").trim();
    const posted = await postManualEntry({ userId: session.userId, companyId }, { date: String(formData.get("date") ?? ""), kind, memo: memo || null, lines });
    revalidatePath(`/c/${companyId}/journal`);
    redirect(`/c/${companyId}/journal/${posted.id}`);
  });
}

export async function reverseEntryAction(companyId: string, entryId: string, _previous: FormState, formData: FormData): Promise<FormState> {
  return safeAction(async () => {
    const session = await requireSession();
    const date = String(formData.get("date") ?? "").trim();
    const memo = String(formData.get("memo") ?? "").trim();
    const reversal = await reverseEntry({ userId: session.userId, companyId }, entryId, { date: date || undefined, memo: memo || null });
    revalidatePath(`/c/${companyId}/journal`);
    redirect(`/c/${companyId}/journal/${reversal.id}`);
  });
}
