import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { can, type AccessContext } from "@/modules/companies";
import { formatMoney, todayIso, type Locale } from "@/modules/ledger";
import { amountInput } from "@/modules/payments";
import { listReceiptAllocations, listReceiptAllocationTargets } from "@/modules/payments";
import { ActionForm, Field } from "@/app/_components/ui";
import { FOCUS } from "@/app/_components/focus";
import { validId } from "../factures/editor";
import { applyReceiptAllocationAction, unapplyReceiptAllocationAction } from "./allocation-actions";

type Query = Record<string, string | string[] | undefined>;

export async function ReceiptAllocationsPanel({ actor, access, paymentId, openCents, posted, locale, query }: {
  actor: { userId: string; companyId: string }; access: AccessContext; paymentId: string; openCents: bigint; posted: boolean; locale: Locale; query: Query;
}) {
  const rawSearch = query.q_affectation;
  const rawPage = query.page_affectation;
  const rawTarget = query.cible_affectation;
  if ([rawSearch, rawPage, rawTarget].some(Array.isArray)) notFound();
  if (typeof rawSearch === "string" && /[\u0000-\u001f\u007f]/.test(rawSearch)) notFound();
  const search = (rawSearch as string | undefined)?.trim() ?? "";
  const pageText = (rawPage as string | undefined) ?? "1";
  const targetId = (rawTarget as string | undefined) ?? "";
  if (search.length > 100 || !/^[1-9]\d{0,4}$/.test(pageText) || (targetId && !validId(targetId))) notFound();
  const t = await getTranslations("receiptAllocations");
  const payments = await getTranslations("payments");
  const history = await listReceiptAllocations(actor, paymentId, Number(pageText));
  const mayWrite = posted && can(access, "sales.manage") && can(access, "entry.post");
  const targets = mayWrite && openCents > 0n ? await listReceiptAllocationTargets(actor, paymentId, search) : { invoices: [], hasMore: false };
  const target = targets.invoices.find(invoice => invoice.id === targetId);
  const base = `/c/${actor.companyId}/encaissements/${paymentId}`;
  const pageHref = (page: number) => `${base}?${new URLSearchParams({ ...(search ? { q_affectation: search } : {}), ...(target ? { cible_affectation: target.id } : {}), page_affectation: String(page) })}`;
  const inputClass = `min-h-11 w-full min-w-0 rounded border border-stone-300 bg-white px-3 text-base dark:border-stone-600 dark:bg-stone-950 ${FOCUS}`;
  const buttonClass = `inline-flex min-h-11 items-center justify-center rounded bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 dark:bg-green-600 dark:hover:bg-green-700 ${FOCUS}`;
  return <section className="space-y-4 rounded border border-stone-300 p-4 dark:border-stone-700" aria-labelledby="receipt-allocations-title">
    <h2 id="receipt-allocations-title" className="font-semibold">{t("title")}</h2>
    <p className="text-sm">{t("intro")}</p>
    <p className="font-semibold tabular-nums">{t("available", { amount: formatMoney(openCents, locale) })}</p>
    {mayWrite && openCents > 0n && <div className="space-y-4">
      <form action={base} method="get" className="space-y-2">
        <label htmlFor="receipt-allocation-search" className="block text-sm font-medium">{t("search")}</label>
        <div className="flex flex-wrap gap-2"><input id="receipt-allocation-search" name="q_affectation" type="search" maxLength={100} defaultValue={search} className={`${inputClass} flex-1 basis-48`} /><button type="submit" className={buttonClass}>{t("searchAction")}</button>{search && <Link href={base} className={`inline-flex min-h-11 items-center px-3 underline ${FOCUS}`}>{t("reset")}</Link>}</div>
      </form>
      {targets.invoices.length ? <form action={base} method="get" className="space-y-2">
        {search && <input type="hidden" name="q_affectation" value={search} />}
        <label htmlFor="receipt-allocation-invoice" className="block text-sm font-medium">{t("invoice")}</label>
        <select id="receipt-allocation-invoice" name="cible_affectation" className={inputClass} defaultValue={target?.id ?? ""} required>
          <option value="" disabled>{t("choose")}</option>
          {targets.invoices.map(invoice => <option key={invoice.id} value={invoice.id}>{invoice.number} · {formatMoney(invoice.openCents, locale)}</option>)}
        </select>
        <button type="submit" className={buttonClass}>{t("review")}</button>
      </form> : <p className="text-sm">{t("noTargets")}</p>}
      {targetId && !target && <p role="status" className="text-sm text-amber-800 dark:text-amber-300">{t("targetUnavailable")}</p>}
      {targets.hasMore && <p className="text-sm text-amber-800 dark:text-amber-300">{t("limit")}</p>}
      {target && <div className="space-y-3 rounded border border-green-700 p-4 dark:border-green-500">
        <h3 className="font-semibold break-words">{t("target", { number: target.number, amount: formatMoney(target.openCents, locale) })}</h3>
        <p className="text-sm">{t("reviewHint")}</p>
        <ActionForm action={applyReceiptAllocationAction.bind(null, actor.companyId, paymentId, target.id, String(openCents), String(target.openCents))} label={t("apply")}>
          <Field name="amount" label={t("amount")} inputMode="decimal" autoComplete="off" defaultValue={amountInput(openCents < target.openCents ? openCents : target.openCents, locale)} />
          <Field name="date" label={t("date")} type="date" defaultValue={todayIso()} />
          <label className="inline-flex min-h-11 items-center gap-3"><input type="checkbox" name="confirm" value="yes" required />{t("confirmApply")}</label>
        </ActionForm>
      </div>}
    </div>}
    {!history.allocations.length ? <p>{t("historyEmpty")}</p> : <ul className="space-y-3">{history.allocations.map(application => <li key={application.id} className="space-y-2 rounded border border-stone-300 p-3 dark:border-stone-700">
      <Link href={`/c/${actor.companyId}/factures/validees/${application.invoiceId}`} className={`inline-flex min-h-11 items-center break-words underline ${FOCUS}`}>{payments("allocationLine", { amount: formatMoney(application.amountCents, locale), number: application.invoiceNumber })}</Link>
      <p className="tabular-nums">{application.appliedDate} · {formatMoney(application.amountCents, locale)}</p>
      <p>{application.unappliedDate ? payments("released", { date: application.unappliedDate }) : t("active")}</p>
      {!application.unappliedDate && mayWrite && <details className="rounded border p-3"><summary className={`min-h-11 cursor-pointer ${FOCUS}`}>{t("release")}</summary>
        <ActionForm action={unapplyReceiptAllocationAction.bind(null, actor.companyId, paymentId, application.id)} label={t("release")}>
          <p className="text-sm">{t("releaseHint")}</p>
          <Field name="date" label={t("releaseDate")} type="date" defaultValue={todayIso()} />
          <label className="inline-flex min-h-11 items-center gap-3"><input type="checkbox" name="confirm" value="yes" required />{t("confirmRelease")}</label>
        </ActionForm>
      </details>}
    </li>)}</ul>}
    {history.pageCount > 1 && <nav aria-label={t("pagination")} className="flex flex-wrap items-center gap-3">
      {history.page > 1 && <Link href={pageHref(history.page - 1)} className={`inline-flex min-h-11 items-center underline ${FOCUS}`}>{t("previous")}</Link>}
      <span className="text-sm">{t("page", { page: history.page, count: history.pageCount })}</span>
      {history.page < history.pageCount && <Link href={pageHref(history.page + 1)} className={`inline-flex min-h-11 items-center underline ${FOCUS}`}>{t("next")}</Link>}
    </nav>}
  </section>;
}
