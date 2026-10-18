import { getTranslations } from "next-intl/server";
import { FOCUS } from "@/app/_components/focus";
import { TABLE_CLASS, TD_CLASS, TH_CLASS } from "@/app/_components/ui";
import { formatMoney, getTrialBalance, isValidIsoDate } from "@/modules/ledger";
import { accountName, loadCompany } from "../_lib";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return { title: (await getTranslations("trial"))("title") };
}

export default async function TrialBalancePage({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<{ au?: string }> }) {
  const { actor, locale } = await loadCompany(params);
  const asOf = (await searchParams).au;
  const t = await getTranslations("trial");
  const trial = await getTrialBalance(actor, { asOf: asOf && isValidIsoDate(asOf) ? asOf : undefined });

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block font-medium">{t("asOf")}</span>
          <input type="date" name="au" defaultValue={trial.asOf ?? ""} className={`rounded-md border border-stone-300 bg-white px-2 py-1.5 dark:border-stone-700 dark:bg-stone-900 ${FOCUS}`} />
        </label>
        <button type="submit" className={`rounded-md border border-stone-300 px-4 py-2 text-sm font-medium hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800 ${FOCUS}`}>
          {t("apply")}
        </button>
      </form>

      {trial.lines.length === 0 ? (
        <p>{t("empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className={TABLE_CLASS}>
            <thead>
              <tr>
                <th scope="col" className={TH_CLASS}>{t("code")}</th>
                <th scope="col" className={`${TH_CLASS} text-right`}>{t("debit")}</th>
                <th scope="col" className={`${TH_CLASS} text-right`}>{t("credit")}</th>
              </tr>
            </thead>
            <tbody>
              {trial.lines.map((line) => (
                <tr key={line.accountId}>
                  <td className={TD_CLASS}>
                    <span className="font-mono">{line.code}</span> – {accountName(line, locale)}
                  </td>
                  <td className={`${TD_CLASS} text-right tabular-nums`}>{line.debitCents > 0n ? formatMoney(line.debitCents, locale) : ""}</td>
                  <td className={`${TD_CLASS} text-right tabular-nums`}>{line.creditCents > 0n ? formatMoney(line.creditCents, locale) : ""}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" className="px-2 py-2 text-left">{t("totals")}</th>
                <td className="px-2 py-2 text-right font-semibold tabular-nums">{formatMoney(trial.totalDebitCents, locale)}</td>
                <td className="px-2 py-2 text-right font-semibold tabular-nums">{formatMoney(trial.totalCreditCents, locale)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div role="status" className="space-y-1 text-sm">
        <p className={trial.balanced ? "text-green-800 dark:text-green-300" : "font-semibold text-red-800 dark:text-red-300"}>{trial.balanced ? t("balanced") : t("notBalanced")}</p>
        <p className={trial.equationHolds ? "text-green-800 dark:text-green-300" : "font-semibold text-red-800 dark:text-red-300"}>{trial.equationHolds ? t("equation") : t("equationBroken")}</p>
      </div>
    </section>
  );
}
