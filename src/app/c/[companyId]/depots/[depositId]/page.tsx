import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { can } from "@/modules/companies";
import { getDeposit } from "@/modules/payments";
import { formatMoney, todayIso } from "@/modules/ledger";
import { ActionForm, Field } from "@/app/_components/ui";
import { FOCUS } from "@/app/_components/focus";
import { accountName, loadCompany } from "../../_lib";
import { voidDepositAction } from "../actions";
export async function generateMetadata() {
  return { title: (await getTranslations("deposits"))("title") };
}
export default async function DepositPage({
  params,
}: {
  params: Promise<{ companyId: string; depositId: string }>;
}) {
  const { company, actor, locale } = await loadCompany(params, "bank.read");
  const { depositId } = await params;
  const deposit = await getDeposit(actor, depositId);
  if (!deposit) notFound();
  const t = await getTranslations("deposits");
  const methods = await getTranslations("payments.methods");
  const base = `/c/${company.id}`;
  const link = `inline-flex min-h-11 max-w-full items-center rounded px-2 text-sm underline ${FOCUS}`;
  return (
    <section className="max-w-4xl space-y-5 break-words">
      <Link href={`${base}/depots`} className={link}>
        {t("back")}
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">
          {t("detail", { number: deposit.number })}
        </h1>
        <span>{t(deposit.status === "POSTED" ? "posted" : "void")}</span>
      </div>
      <dl className="grid gap-4 rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900 sm:grid-cols-2">
        <div>
          <dt className="text-sm">{t("date")}</dt>
          <dd>{deposit.date}</dd>
        </div>
        <div>
          <dt className="text-sm">{t("account")}</dt>
          <dd>
            {deposit.account.code} · {accountName(deposit.account, locale)}
          </dd>
        </div>
        <div>
          <dt className="text-sm">{t("total")}</dt>
          <dd className="font-semibold tabular-nums">
            {formatMoney(deposit.totalCents, locale)}
          </dd>
        </div>
        {deposit.reference ? (
          <div>
            <dt className="text-sm">{t("reference")}</dt>
            <dd>{deposit.reference}</dd>
          </div>
        ) : null}
      </dl>
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">{t("contents")}</h2>
        <p className="text-sm">{t("postingHint")}</p>
        <ul className="divide-y divide-stone-200 dark:divide-stone-800">
          {deposit.items.map((p) => (
            <li
              key={p.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2"
            >
              <div>
                {can(company, "sales.read") ? (
                  <Link href={`${base}/encaissements/${p.id}`} className={link}>
                    {p.number}
                  </Link>
                ) : (
                  <span>{p.number}</span>
                )}
                <p className="text-sm">
                  {p.date} · {methods(p.method)}
                  {p.reference ? ` · ${p.reference}` : ""}
                </p>
              </div>
              <span className="tabular-nums">
                {formatMoney(p.amountCents, locale)}
              </span>
            </li>
          ))}
        </ul>
        <Link
          href={`${base}/journal/${deposit.journalEntryId}`}
          className={link}
        >
          {t("entry")}
        </Link>
      </div>
      {deposit.status === "VOID" ? (
        <div className="space-y-2 rounded border border-amber-600 p-4">
          <p>{t("voidedOn", { date: deposit.voidDate ?? "" })}</p>
          <p>{deposit.voidReason ?? t("legacyReason")}</p>
          <p className="text-sm">{t("released")}</p>
          {deposit.voidEntryId ? (
            <Link
              href={`${base}/journal/${deposit.voidEntryId}`}
              className={link}
            >
              {t("reversal")}
            </Link>
          ) : null}
        </div>
      ) : deposit.linked ? (
        <p className="rounded border border-amber-600 p-4 text-sm">
          {t("linked")}
        </p>
      ) : can(company, "bank.manage") ? (
        <details className="rounded border border-stone-300 p-4 dark:border-stone-700">
          <summary className="min-h-11 cursor-pointer">
            {t("voidTitle")}
          </summary>
          <ActionForm
            action={voidDepositAction.bind(null, company.id, deposit.id)}
            label={t("voidSubmit")}
          >
            <p className="text-sm">{t("voidHint")}</p>
            <Field
              name="date"
              type="date"
              label={t("voidDate")}
              defaultValue={todayIso()}
            />
            <Field name="reason" label={t("reason")} />
            <label className="flex min-h-11 items-start gap-3 text-sm">
              <input
                type="checkbox"
                name="confirm"
                value="yes"
                required
                className="mt-1 size-5 shrink-0"
              />
              {t("voidConfirm")}
            </label>
          </ActionForm>
        </details>
      ) : null}
    </section>
  );
}
