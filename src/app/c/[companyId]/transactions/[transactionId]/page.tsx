import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { can } from "@/modules/companies";
import { acceptsManualEntries, formatMoney, listAccounts } from "@/modules/ledger";
import { DEFAULT_CANDIDATE_DAYS, getBankTransaction, listMatchCandidates, listTransferCandidates, MAX_CANDIDATE_DAYS } from "@/modules/banking";
import { searchText } from "@/app/_lib/search-params";
import { ActionForm, Field, SelectField } from "@/app/_components/ui";
import { FOCUS } from "@/app/_components/focus";
import { accountName, loadCompany } from "../../_lib";
import { recordAction, setStatusAction, transferAction, unmatchAction } from "../actions";
import { LedgerLine } from "../matched-lines";
import { MatchPicker } from "./match-picker";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WIDER = [DEFAULT_CANDIDATE_DAYS, 90, MAX_CANDIDATE_DAYS] as const;

export async function generateMetadata() {
  return { title: (await getTranslations("transactionDetail"))("title") };
}

export default async function TransactionPage({ params, searchParams }: { params: Promise<{ companyId: string; transactionId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { transactionId } = await params;
  const { company, actor, locale } = await loadCompany(params);
  if (!UUID.test(transactionId)) notFound();
  const transaction = await getBankTransaction(actor, transactionId);
  if (!transaction) notFound();
  const query = await searchParams;
  const asked = Number(searchText(query.days));
  const days = WIDER.find((value) => value === asked) ?? DEFAULT_CANDIDATE_DAYS;
  const t = await getTranslations("transactionDetail");
  const ts = await getTranslations("transactions");
  const base = `/c/${company.id}/transactions`;
  const canManage = can(company.role, "bank.manage");
  const canPost = can(company.role, "entry.post");
  const waiting = transaction.status === "UNMATCHED";
  const money = (cents: bigint) => `${formatMoney(cents, locale)}${transaction.currency === "CAD" ? "" : ` ${transaction.currency}`}`;
  const inflow = transaction.amountCents > 0n;
  const bankLabel = `${transaction.accountCode} · ${accountName({ nameFr: transaction.accountNameFr, nameEn: transaction.accountNameEn }, locale)}`;
  const working = waiting && canManage && transaction.currency === "CAD";

  const candidates = working ? await listMatchCandidates(actor, transaction.id, { days }) : [];
  const accounts = working && canPost ? (await listAccounts(actor)).filter((account) => acceptsManualEntries(account) && account.id !== transaction.accountId) : [];
  const transfers = working && canPost ? await listTransferCandidates(actor, transaction.id) : [];
  const section = "space-y-3 rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900";
  const link = `inline-flex min-h-11 items-center rounded px-3 text-sm underline ${FOCUS}`;

  return (
    <section className="space-y-5">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold break-words">{transaction.description}</h1>
        <p className="text-lg font-semibold tabular-nums">{money(transaction.amountCents)}</p>
        <p className="text-sm break-words">{transaction.date} · {ts(`statuses.${transaction.status}`)} · {bankLabel}</p>
        {transaction.payee && transaction.payee !== transaction.description ? <p className="text-sm break-words">{transaction.payee}</p> : null}
        {transaction.source.kind === "file" ? <p className="text-sm text-stone-600 dark:text-stone-400 break-words">{ts("fromFile", { file: transaction.source.fileName })}</p> : null}
        {transaction.source.kind === "service" ? <p className="text-sm text-stone-600 dark:text-stone-400 break-words">{ts("fromService", { label: transaction.source.label })}</p> : null}
      </div>

      {transaction.status === "MATCHED" ? (
        <div className={section}>
          <h2 className="text-lg font-semibold">{t("matchedTitle")}</h2>
          <ul className="space-y-1 text-sm">
            {transaction.matches.map((match) => <li key={match.lineId}><LedgerLine companyId={company.id} line={match} locale={locale} /></li>)}
          </ul>
          {canManage && !transaction.matches.some((match) => match.reconciled) ? (
            <>
              <p className="text-sm">{t("undoHint")}</p>
              <ActionForm action={unmatchAction.bind(null, company.id, transaction.id)} label={ts("undo")} />
            </>
          ) : null}
          {transaction.matches.some((match) => match.reconciled) ? <p className="text-sm">{t("reconciledHint")}</p> : null}
        </div>
      ) : null}

      {transaction.status === "EXCLUDED" ? (
        <div className={section}>
          <p>{t("excluded")}</p>
          {canManage ? <ActionForm action={setStatusAction.bind(null, company.id, transaction.id, "UNMATCHED")} label={ts("restore")} /> : null}
        </div>
      ) : null}

      {waiting && !canManage ? <p role="note" className="text-sm">{t("readOnly")}</p> : null}
      {waiting && canManage && transaction.currency !== "CAD" ? <p role="note" className="text-sm">{t("foreignCurrency", { currency: transaction.currency })}</p> : null}

      {working ? (
        <>
          <div className={section}>
            <h2 className="text-lg font-semibold">{t("matchTitle")}</h2>
            <p className="text-sm">{t("matchIntro", { amount: money(transaction.amountCents) })}</p>
            {candidates.length === 0 ? <p className="text-sm">{t("noCandidates", { days })}</p> : (
              <MatchPicker
                companyId={company.id}
                transactionId={transaction.id}
                target={transaction.amountCents.toString()}
                candidates={candidates.map((candidate) => ({
                  lineId: candidate.lineId,
                  label: [candidate.entryLabel, candidate.entryDate, candidate.memo || candidate.description, candidate.contactName].filter(Boolean).join(" · "),
                  cents: candidate.cents.toString(),
                  reversed: candidate.reversed,
                  reconciled: candidate.reconciled,
                }))}
              />
            )}
            <p className="flex flex-wrap items-center gap-x-1 text-sm">
              {t("window", { days })}
              {WIDER.filter((value) => value > days).map((value) => <Link key={value} href={`${base}/${transaction.id}?days=${value}`} className={link}>{t("widen", { days: value })}</Link>)}
            </p>
          </div>

          {canPost ? (
            <div className={section}>
              <h2 className="text-lg font-semibold">{t("recordTitle")}</h2>
              <p className="text-sm">{t(inflow ? "recordIn" : "recordOut", { account: bankLabel, date: transaction.date })}</p>
              <ActionForm action={recordAction.bind(null, company.id, transaction.id)} label={t("recordSubmit")} variant="primary">
                <SelectField name="accountId" label={t("counterAccount")} options={accounts.map((account) => ({ value: account.id, label: `${account.code} – ${accountName(account, locale)}` }))} />
                <Field name="memo" label={t("memo")} defaultValue={transaction.description.slice(0, 200)} required={false} autoComplete="off" />
              </ActionForm>
            </div>
          ) : null}

          {canPost ? (
            <div className={section}>
              <h2 className="text-lg font-semibold">{t("transferTitle")}</h2>
              <p className="text-sm">{t("transferIntro")}</p>
              {transfers.length === 0 ? <p className="text-sm">{t("noTransfers")}</p> : (
                <ul className="space-y-3">
                  {transfers.map((other) => (
                    <li key={other.id} className="space-y-2 rounded border border-stone-300 p-3 text-sm dark:border-stone-700">
                      <p className="break-words">{other.date} · {other.description} · <span className="tabular-nums">{money(other.amountCents)}</span> · {other.accountCode} · {accountName({ nameFr: other.accountNameFr, nameEn: other.accountNameEn }, locale)}</p>
                      <ActionForm action={transferAction.bind(null, company.id, transaction.id, other.id)} label={t("transferSubmit")} ariaLabel={t("transferNamed", { description: other.description })} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}

          <div className={section}>
            <p className="text-sm">{t("setAsideHint")}</p>
            <ActionForm action={setStatusAction.bind(null, company.id, transaction.id, "EXCLUDED")} label={ts("setAside")} />
          </div>
        </>
      ) : null}

      <Link href={base} className={`inline-block rounded-sm text-sm underline ${FOCUS}`}>{t("back")}</Link>
    </section>
  );
}
