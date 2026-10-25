"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/app/_lib/session";
import { safeAction } from "@/app/_lib/safe-action";
import { textValues, type FormState } from "@/app/_lib/form-state";
import { AppError } from "@/platform/errors";
import { categorizeTransaction, createTransfer, importStatement, MAX_STATEMENT_BYTES, matchTransaction, setTransactionStatus, unmatchTransaction } from "@/modules/banking";

/** Sets a statement line aside, or brings it back. */
export async function setStatusAction(companyId: string, transactionId: string, status: "UNMATCHED" | "EXCLUDED", _previous: FormState, _form: FormData): Promise<FormState> {
  return safeAction(async () => {
    const session = await requireSession();
    await setTransactionStatus({ userId: session.userId, companyId }, transactionId, status);
    revalidatePath(`/c/${companyId}/transactions`);
    return undefined;
  });
}

/** Everything that matches or records a line changes the lists, the journal and the balances. */
const refresh = (companyId: string) => revalidatePath(`/c/${companyId}`, "layout");

/** Matches a transaction to the ledger lines the form carries (one `line` field each). */
export async function matchAction(companyId: string, transactionId: string, _previous: FormState, form: FormData): Promise<FormState> {
  return safeAction(async () => {
    const session = await requireSession();
    await matchTransaction({ userId: session.userId, companyId }, transactionId, form.getAll("line").map(String));
    refresh(companyId);
    return undefined;
  });
}

/** Undoes the match of a transaction. */
export async function unmatchAction(companyId: string, transactionId: string, _previous: FormState, _form: FormData): Promise<FormState> {
  return safeAction(async () => {
    const session = await requireSession();
    await unmatchTransaction({ userId: session.userId, companyId }, transactionId);
    refresh(companyId);
    return undefined;
  });
}

/** Records a transaction against another account. */
export async function recordAction(companyId: string, transactionId: string, _previous: FormState, form: FormData): Promise<FormState> {
  const values = textValues(form, ["accountId", "memo"]);
  return safeAction(async () => {
    const session = await requireSession();
    await categorizeTransaction({ userId: session.userId, companyId }, transactionId, { accountId: values.accountId ?? "", memo: values.memo });
    refresh(companyId);
    return undefined;
  }, values);
}

/** Records two transactions as one transfer between two accounts. */
export async function transferAction(companyId: string, transactionId: string, otherTransactionId: string, _previous: FormState, _form: FormData): Promise<FormState> {
  return safeAction(async () => {
    const session = await requireSession();
    await createTransfer({ userId: session.userId, companyId }, { transactionId, otherTransactionId });
    refresh(companyId);
    return undefined;
  });
}

/**
 * Imports the file of a statement. The browser read it for the preview; the server reads it again, with the same code,
 * and stores nothing the file does not say. The counts go back to the page in its address (counts, never a line).
 */
export async function importStatementAction(companyId: string, _previous: FormState, form: FormData): Promise<FormState> {
  const values = textValues(form, ["accountId"]);
  return safeAction(async () => {
    const session = await requireSession();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new AppError("banking.empty");
    if (file.size > MAX_STATEMENT_BYTES) throw new AppError("banking.tooLarge");
    const raw = String(form.get("mapping") ?? "");
    let mapping: unknown;
    if (raw) {
      try {
        mapping = JSON.parse(raw);
      } catch {
        throw new AppError("banking.mapping");
      }
    }
    const result = await importStatement({ userId: session.userId, companyId }, { accountId: values.accountId ?? "", fileName: file.name, bytes: new Uint8Array(await file.arrayBuffer()), mapping });
    revalidatePath(`/c/${companyId}`, "layout");
    redirect(`/c/${companyId}/transactions?${new URLSearchParams({ account: values.accountId ?? "", imported: String(result.imported), duplicates: String(result.duplicates), skipped: String(result.skipped) })}`);
  }, values);
}
