import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { can } from "@/modules/companies";
import { formatMoney } from "@/modules/ledger";
import { getWorksheet, type WorksheetLine } from "@/modules/banking";
import { ActionForm, Field } from "@/app/_components/ui";
import { FOCUS } from "@/app/_components/focus";
import { accountName, loadCompany } from "../../_lib";
import { clearMatchedAction, completeAction, discardAction, reopenAction } from "../actions";
import { ReconcileForm } from "./reconcile-form";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata() { return { title: (await getTranslations("reconciliation"))("sheetTitle") }; }

const label = (line: WorksheetLine) => [line.entryLabel, line.entryDate, line.memo || line.description, line.contactName].filter(Boolean).join(" · ");

export default async function WorksheetPage({ params }: { params: Promise<{ companyId: string; reconciliationId: string }> }) {
  const { reconciliationId } = await params;
  const { company, actor, locale } = await loadCompany(params);
  if (!UUID.test(reconciliationId)) notFound();
  const sheet = await getWorksheet(actor, reconciliationId);
  if (!sheet) notFound();
  const t = await getTranslations("reconciliation");
  const rec = sheet.reconciliation;
  const base = `/c/${company.id}/rapprochement`;
  const canManage = can(company.role, "bank.manage");
  const inProgress = rec.status === "IN_PROGRESS";
  const sign = BigInt(rec.sign);
  const difference = sheet.statementLedgerCents - sheet.previousCents - sheet.clearedCents; // as saved, in ledger terms
  const section = "space-y-3 rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900";
  const money = (cents: bigint) => formatMoney(cents, locale);
  const matchedLines = sheet.lines.filter((line) => line.transaction !== null && !line.cleared).length;
  return (
    <section className="space-y-5">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold break-words">{t("sheetHeading", { account: `${rec.accountCode} · ${accountName({ nameFr: rec.accountNameFr, nameEn: rec.accountNameEn }, locale)}`, date: rec.statementDate })}</h1>
        <p className="text-sm">{t(inProgress ? "inProgressState" : "completedState")}{rec.completedAt ? ` · ${rec.completedAt.toISOString().slice(0, 10)}` : ""}</p>
        <dl className="grid max-w-lg grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm tabular-nums">
          <dt>{t("statementBalance")}</dt><dd className="text-right">{money(rec.statementBalanceCents)}</dd>
          <dt>{t("previousStatements")}</dt><dd className="text-right">{money(sign * sheet.previousCents)}</dd>
          <dt>{t("countedHere")}</dt><dd className="text-right">{money(sign * sheet.clearedCents)}</dd>
          <dt className="font-medium">{t("difference")}</dt><dd className={`text-right font-medium ${difference === 0n ? "text-brand-700 dark:text-brand-500" : ""}`}>{money(sign * difference)}</dd>
        </dl>
        {rec.sign === -1 ? <p className="text-sm text-stone-600 dark:text-stone-400">{t("cardNote")}</p> : null}
      </div>

      {inProgress && canManage ? (
        <>
          <div className={section}>
            <h2 className="text-lg font-semibold">{t("tickTitle")}</h2>
            <p className="text-sm">{t("tickIntro", { date: rec.statementDate })}</p>
            {matchedLines > 0 ? (
              <ActionForm action={clearMatchedAction.bind(null, company.id, rec.id)} label={t("tickMatched", { count: matchedLines })} />
            ) : null}
            {sheet.lines.length === 0 ? <p className="text-sm">{t("noLines")}</p> : (
              <ReconcileForm
                companyId={company.id}
                reconciliationId={rec.id}
                sign={rec.sign}
                statementLedger={sheet.statementLedgerCents.toString()}
                previous={sheet.previousCents.toString()}
                lines={sheet.lines.map((line) => ({ lineId: line.lineId, label: label(line), cents: line.cents.toString(), cleared: line.cleared, transaction: line.transaction?.description ?? null, reversed: line.reversed }))}
              />
            )}
          </div>
          <div className={section}>
            <h2 className="text-lg font-semibold">{t("completeTitle")}</h2>
            {difference === 0n ? (
              <>
                <p className="text-sm">{t("completeReady")}</p>
                <ActionForm action={completeAction.bind(null, company.id, rec.id)} label={t("complete")} variant="primary" />
              </>
            ) : <p className="text-sm">{t("completeWait", { difference: money(sign * difference) })}</p>}
          </div>
          <div className={section}>
            <p className="text-sm">{t("discardHint")}</p>
            <ActionForm action={discardAction.bind(null, company.id, rec.id)} label={t("discard")} />
          </div>
        </>
      ) : (
        <div className={section}>
          <h2 className="text-lg font-semibold">{t(inProgress ? "linesTitleView" : "linesTitleDone")}</h2>
          {sheet.lines.length === 0 ? <p className="text-sm">{t("noLines")}</p> : (
            <ul className="space-y-2">
              {sheet.lines.map((line) => (
                <li key={line.lineId} className="flex items-start justify-between gap-3 rounded border border-stone-300 p-3 text-sm dark:border-stone-700">
                  <span className="min-w-0 break-words">
                    {line.cleared ? "✓ " : ""}{label(line)}
                    {line.transaction ? ` · ${t("matchedTo", { description: line.transaction.description })}` : ""}
                    {line.reversed ? ` · ${t("reversed")}` : ""}
                  </span>
                  <span className="shrink-0 font-medium tabular-nums">{money(line.cents)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!inProgress && canManage ? (
        <div className={section}>
          <h2 className="text-lg font-semibold">{t("reopenTitle")}</h2>
          {sheet.canReopen ? (
            <>
              <p className="text-sm">{t("reopenHint")}</p>
              <ActionForm action={reopenAction.bind(null, company.id, rec.id)} label={t("reopen")}>
                <Field name="reason" label={t("reopenReason")} hint={t("reopenReasonHint")} autoComplete="off" />
              </ActionForm>
            </>
          ) : <p className="text-sm">{t("reopenOnlyLatest")}</p>}
        </div>
      ) : null}

      <Link href={base} className={`inline-block rounded-sm text-sm underline ${FOCUS}`}>{t("back")}</Link>
    </section>
  );
}
