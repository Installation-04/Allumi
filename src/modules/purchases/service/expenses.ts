import "server-only";
import type { CompanyContext } from "@/platform/tenant";
import { getDraft, getDraftOptions, listDrafts, saveDraft, deleteDraft } from "./drafts";
import { listDisbursementAccounts } from "@/modules/payments";
export async function getExpenseDraftOptions(actor: CompanyContext) { return { ...await getDraftOptions(actor), paymentAccounts: await listDisbursementAccounts(actor) }; }
export const getExpenseDraft = (actor: CompanyContext, id: string) => getDraft(actor, id, "EXPENSE");
export const listExpenseDrafts = (actor: CompanyContext, q = "") => listDrafts(actor, q, "EXPENSE");
export const saveExpenseDraft = (actor: CompanyContext, input: unknown, id?: string) => saveDraft(actor, input, id, "EXPENSE");
export const deleteExpenseDraft = (actor: CompanyContext, id: string, revision: string) => deleteDraft(actor, id, revision, "EXPENSE");
