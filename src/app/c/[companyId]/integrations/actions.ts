"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/app/_lib/session";
import { safeAction } from "@/app/_lib/safe-action";
import { textValues, type FormState } from "@/app/_lib/form-state";
import { AppError } from "@/platform/errors";
import { createConnection, disconnect, replaceCredentials, setImportedStatus, syncConnection, type ProviderId } from "@/modules/integrations";

/** The credentials as typed. A secret field is read from the form and goes nowhere else: never back to the page, never logged. */
const credentialsOf = (provider: ProviderId, form: FormData) =>
  provider === "STRIPE"
    ? { apiKey: String(form.get("apiKey") ?? "") }
    : { clientId: String(form.get("clientId") ?? ""), clientSecret: String(form.get("clientSecret") ?? "") };

/** What a refused form shows again: everything but the secrets (the person types the key again). */
const KEEP = ["label", "accountId", "importFrom", "environment", "clientId"];

export async function connectAction(companyId: string, provider: ProviderId, _previous: FormState, form: FormData): Promise<FormState> {
  const values = textValues(form, KEEP);
  return safeAction(async () => {
    const session = await requireSession();
    const { id } = await createConnection({ userId: session.userId, companyId }, {
      provider, label: values.label, accountId: values.accountId, importFrom: values.importFrom, environment: values.environment === "sandbox" ? "sandbox" : "live", credentials: credentialsOf(provider, form),
    });
    revalidatePath(`/c/${companyId}`, "layout");
    redirect(`/c/${companyId}/integrations/${id}`);
  }, values);
}

/** Imports what is new. The result goes back to the page in its address (a count, never a transaction). */
export async function syncAction(companyId: string, connectionId: string, _previous: FormState, _form: FormData): Promise<FormState> {
  return safeAction(async () => {
    const session = await requireSession();
    const result = await syncConnection({ userId: session.userId, companyId }, connectionId);
    revalidatePath(`/c/${companyId}`, "layout");
    const skipped = result.skipped.unsupportedCurrency + result.skipped.notSettled;
    redirect(`/c/${companyId}/integrations/${connectionId}?${new URLSearchParams({ imported: String(result.imported), skipped: String(skipped), more: result.complete ? "0" : "1" })}`);
  });
}

export async function replaceCredentialsAction(companyId: string, connectionId: string, provider: ProviderId, _previous: FormState, form: FormData): Promise<FormState> {
  const values = textValues(form, ["clientId"]);
  return safeAction(async () => {
    const session = await requireSession();
    await replaceCredentials({ userId: session.userId, companyId }, connectionId, credentialsOf(provider, form));
    revalidatePath(`/c/${companyId}`, "layout");
    redirect(`/c/${companyId}/integrations/${connectionId}?keys=1`);
  }, values);
}

export async function disconnectAction(companyId: string, connectionId: string, _previous: FormState, form: FormData): Promise<FormState> {
  return safeAction(async () => {
    if (form.get("confirm") !== "yes") throw new AppError("integrations.confirmDisconnect");
    const session = await requireSession();
    await disconnect({ userId: session.userId, companyId }, connectionId);
    revalidatePath(`/c/${companyId}`, "layout");
    return undefined;
  });
}

export async function setStatusAction(companyId: string, transactionId: string, status: "UNMATCHED" | "EXCLUDED", _previous: FormState, _form: FormData): Promise<FormState> {
  return safeAction(async () => {
    const session = await requireSession();
    await setImportedStatus({ userId: session.userId, companyId }, transactionId, status);
    revalidatePath(`/c/${companyId}/transactions`);
    return undefined;
  });
}
