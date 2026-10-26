"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/app/_lib/session";
import { safeAction } from "@/app/_lib/safe-action";
import { textValues, type FormState } from "@/app/_lib/form-state";
import { AppError } from "@/platform/errors";
import { cancelPaymentLink, collectPayments, createConnection, createPaymentLink, disconnect, replaceCredentials, setFeeAccount, syncConnection, type ProviderId } from "@/modules/integrations";

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

/** Where the processing fees of online payments are booked. */
export async function setFeeAccountAction(companyId: string, connectionId: string, _previous: FormState, form: FormData): Promise<FormState> {
  const values = textValues(form, ["accountId"]);
  return safeAction(async () => {
    const session = await requireSession();
    await setFeeAccount({ userId: session.userId, companyId }, connectionId, values.accountId ?? "");
    revalidatePath(`/c/${companyId}`, "layout");
    return { notice: "saved" };
  }, values);
}

/** Looks at the payment pages of a connection and books what was paid. The counts go back to the page in its address, never a payment. */
export async function collectPaymentsAction(companyId: string, connectionId: string, back: string, _previous: FormState, _form: FormData): Promise<FormState> {
  return safeAction(async () => {
    const session = await requireSession();
    const result = await collectPayments({ userId: session.userId, companyId }, { connectionId });
    revalidatePath(`/c/${companyId}`, "layout");
    const counts = new URLSearchParams({
      checked: String(result.checked), paid: String(result.paid), review: String(result.review), extra: String(result.extra), waiting: String(result.waiting), failed: String(result.failed), more: result.more ? "1" : "0",
    });
    redirect(`${back}?${counts}`);
  });
}

export async function createPaymentLinkAction(companyId: string, invoiceId: string, _previous: FormState, form: FormData): Promise<FormState> {
  const values = textValues(form, ["connectionId"]);
  return safeAction(async () => {
    const session = await requireSession();
    await createPaymentLink({ userId: session.userId, companyId }, { invoiceId, connectionId: values.connectionId });
    revalidatePath(`/c/${companyId}`, "layout");
    return { notice: "saved" };
  }, values);
}

export async function cancelPaymentLinkAction(companyId: string, invoiceId: string, linkId: string, _previous: FormState, _form: FormData): Promise<FormState> {
  return safeAction(async () => {
    const session = await requireSession();
    const result = await cancelPaymentLink({ userId: session.userId, companyId }, linkId);
    revalidatePath(`/c/${companyId}`, "layout");
    const outcome = result.status === "CANCELLED" ? (result.closedAtService ? "cancelled" : "cancelledOpen") : result.status === "PAID" ? "paid" : "review";
    redirect(`/c/${companyId}/factures/validees/${invoiceId}?cancel=${outcome}`);
  });
}
