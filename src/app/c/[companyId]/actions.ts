"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/app/_lib/session";
import { safeAction } from "@/app/_lib/safe-action";
import type { FormState } from "@/app/_lib/form-state";
import { initializeLedger } from "@/modules/ledger";

export async function initializeLedgerAction(companyId: string, _previous: FormState, _formData: FormData): Promise<FormState> {
  return safeAction(async () => {
    const session = await requireSession();
    await initializeLedger({ userId: session.userId, companyId });
    revalidatePath(`/c/${companyId}`, "layout");
    return undefined;
  });
}
