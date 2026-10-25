"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { requireSession } from "@/app/_lib/session";
import { safeAction } from "@/app/_lib/safe-action";
import { textValues, type FormState } from "@/app/_lib/form-state";
import { AppError } from "@/platform/errors";
import { clearMatchedLines, completeReconciliation, discardReconciliation, reopenReconciliation, saveCleared, startReconciliation } from "@/modules/banking";
import { parseMoney, type Locale } from "@/modules/ledger";

/** What changes on a reconciliation changes its page, the list, and what the transactions say about their lines. */
const refresh = (companyId: string) => revalidatePath(`/c/${companyId}`, "layout");

/** Starts a reconciliation: the statement's day and balance, as the statement says it. */
export async function startAction(companyId: string, _previous: FormState, form: FormData): Promise<FormState> {
  const values = textValues(form, ["accountId", "statementDate", "balance"]);
  return safeAction(async () => {
    const session = await requireSession();
    const locale: Locale = (await getLocale()) === "en" ? "en" : "fr-CA";
    const cents = parseMoney(values.balance ?? "", locale);
    if (cents === null) throw new AppError("banking.reconInvalid");
    const started = await startReconciliation({ userId: session.userId, companyId }, { accountId: values.accountId ?? "", statementDate: values.statementDate ?? "", statementBalanceCents: cents });
    refresh(companyId);
    redirect(`/c/${companyId}/rapprochement/${started.id}`);
  }, values);
}

/** Saves the lines that are ticked, as a whole. */
export async function saveAction(companyId: string, reconciliationId: string, _previous: FormState, form: FormData): Promise<FormState> {
  return safeAction(async () => {
    const session = await requireSession();
    await saveCleared({ userId: session.userId, companyId }, reconciliationId, form.getAll("line").map(String));
    refresh(companyId);
    return { notice: "saved" };
  });
}

/** Ticks the lines that are matched to statement lines. */
export async function clearMatchedAction(companyId: string, reconciliationId: string, _previous: FormState, _form: FormData): Promise<FormState> {
  return safeAction(async () => {
    const session = await requireSession();
    await clearMatchedLines({ userId: session.userId, companyId }, reconciliationId);
    refresh(companyId);
    return undefined;
  });
}

/** Completes the reconciliation: what was saved comes to the statement's balance. */
export async function completeAction(companyId: string, reconciliationId: string, _previous: FormState, _form: FormData): Promise<FormState> {
  return safeAction(async () => {
    const session = await requireSession();
    await completeReconciliation({ userId: session.userId, companyId }, reconciliationId);
    refresh(companyId);
    return undefined;
  });
}

/** Reopens the latest completed reconciliation of an account, with the reason the audit trail keeps. */
export async function reopenAction(companyId: string, reconciliationId: string, _previous: FormState, form: FormData): Promise<FormState> {
  const values = textValues(form, ["reason"]);
  return safeAction(async () => {
    const session = await requireSession();
    await reopenReconciliation({ userId: session.userId, companyId }, reconciliationId, values.reason ?? "");
    refresh(companyId);
    return undefined;
  }, values);
}

/** Abandons a reconciliation in progress. */
export async function discardAction(companyId: string, reconciliationId: string, _previous: FormState, _form: FormData): Promise<FormState> {
  return safeAction(async () => {
    const session = await requireSession();
    await discardReconciliation({ userId: session.userId, companyId }, reconciliationId);
    refresh(companyId);
    redirect(`/c/${companyId}/rapprochement`);
  });
}
