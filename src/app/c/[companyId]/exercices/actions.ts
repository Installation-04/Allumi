"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/app/_lib/session";
import { safeAction } from "@/app/_lib/safe-action";
import { textValues, type FormState } from "@/app/_lib/form-state";
import { closeFiscalYear, createFiscalYear, lockPeriod, reopenFiscalYear, reopenPeriod } from "@/modules/ledger";

async function run(companyId: string, work: (actor: { userId: string; companyId: string }) => Promise<void>, values?: Record<string, string>): Promise<FormState> {
  return safeAction(async () => {
    const session = await requireSession();
    await work({ userId: session.userId, companyId });
    revalidatePath(`/c/${companyId}/exercices`);
    return undefined;
  }, values);
}

const reason = (formData: FormData) => String(formData.get("reason") ?? "");
/** The code typed now by the owner. It is never sent back to the form (a one-time code is not kept). */
const proof = (formData: FormData) => ({ code: String(formData.get("code") ?? "").trim() });

/** Creates the year after the last one, or, when a date is given, the year that contains it (opening balances in the past). */
export async function createYearAction(companyId: string, _previous: FormState, formData: FormData): Promise<FormState> {
  const containing = String(formData.get("containing") ?? "").trim();
  return run(companyId, async (actor) => {
    await createFiscalYear(actor, containing ? { containing } : {});
  }, { containing });
}

export async function lockPeriodAction(companyId: string, periodId: string, _previous: FormState, _formData: FormData): Promise<FormState> {
  return run(companyId, (actor) => lockPeriod(actor, periodId));
}

export async function reopenPeriodAction(companyId: string, periodId: string, _previous: FormState, formData: FormData): Promise<FormState> {
  return run(companyId, (actor) => reopenPeriod(actor, periodId, reason(formData), proof(formData)), textValues(formData, ["reason"]));
}

export async function closeYearAction(companyId: string, yearId: string, _previous: FormState, _formData: FormData): Promise<FormState> {
  return run(companyId, (actor) => closeFiscalYear(actor, yearId));
}

export async function reopenYearAction(companyId: string, yearId: string, _previous: FormState, formData: FormData): Promise<FormState> {
  return run(companyId, (actor) => reopenFiscalYear(actor, yearId, reason(formData), proof(formData)), textValues(formData, ["reason"]));
}
