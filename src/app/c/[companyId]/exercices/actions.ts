"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/app/_lib/session";
import { safeAction } from "@/app/_lib/safe-action";
import type { FormState } from "@/app/_lib/form-state";
import { closeFiscalYear, createFiscalYear, lockPeriod, reopenFiscalYear, reopenPeriod } from "@/modules/ledger";

async function run(companyId: string, work: (actor: { userId: string; companyId: string }) => Promise<void>): Promise<FormState> {
  return safeAction(async () => {
    const session = await requireSession();
    await work({ userId: session.userId, companyId });
    revalidatePath(`/c/${companyId}/exercices`);
    return undefined;
  });
}

const reason = (formData: FormData) => String(formData.get("reason") ?? "");

export async function createYearAction(companyId: string, _previous: FormState, _formData: FormData): Promise<FormState> {
  return run(companyId, async (actor) => {
    await createFiscalYear(actor);
  });
}

export async function lockPeriodAction(companyId: string, periodId: string, _previous: FormState, _formData: FormData): Promise<FormState> {
  return run(companyId, (actor) => lockPeriod(actor, periodId));
}

export async function reopenPeriodAction(companyId: string, periodId: string, _previous: FormState, formData: FormData): Promise<FormState> {
  return run(companyId, (actor) => reopenPeriod(actor, periodId, reason(formData)));
}

export async function closeYearAction(companyId: string, yearId: string, _previous: FormState, _formData: FormData): Promise<FormState> {
  return run(companyId, (actor) => closeFiscalYear(actor, yearId));
}

export async function reopenYearAction(companyId: string, yearId: string, _previous: FormState, formData: FormData): Promise<FormState> {
  return run(companyId, (actor) => reopenFiscalYear(actor, yearId, reason(formData)));
}
