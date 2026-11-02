import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { FOCUS } from "@/app/_components/focus";
import { TABLE_CLASS, TD_CLASS } from "@/app/_components/table";
import { balanceDay } from "@/app/_lib/report-period";
import { formatMoney, todayIso } from "@/modules/ledger";
import { getBalanceSheet } from "@/modules/reports";
import { accountName, loadCompany } from "../_lib";
import { FigureRow, SectionRows } from "../_statement-table";

export const dynamic = "force-dynamic";

export async function generateMetadata() { return { title: (await getTranslations("statements"))("balanceTitle") }; }

export default async function BalanceSheetPage({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { company, actor, locale } = await loadCompany(params, "ledger.read");
  const t = await getTranslations("statements");
  const c = await getTranslations("balanceComparison");
  const asOf = balanceDay(await searchParams, todayIso());
  const { sheet, fiscalYearStart } = await getBalanceSheet(actor, asOf);
  const base = `/c/${company.id}/bilan`;
  const control = `min-h-11 rounded-md border border-stone-300 bg-white px-3 dark:border-stone-700 dark:bg-stone-900 ${FOCUS}`;
  const amount = "tabular-nums text-right";
  const empty = [sheet.currentAssets, sheet.fixedAssets, sheet.otherAssets, sheet.currentLiabilities, sheet.longTermLiabilities, sheet.equity].every((part) => part.lines.length === 0)
    && sheet.priorEarningsCents === 0n && sheet.currentEarningsCents === 0n;
  return (
    <section className="space-y-5">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("balanceTitle")}</h1>
        <p className="text-sm text-stone-600 dark:text-stone-400">{t("balanceIntro")}</p>
      </div>
      <Link className={`inline-flex min-h-11 items-center underline ${FOCUS}`} href={`/c/${company.id}/bilan/comparer?${new URLSearchParams({au:asOf})}`}>{c("open")}</Link>
      <form key={asOf} method="get" className="flex flex-wrap items-end gap-3">
        <label className="text-sm"><span className="mb-1 block font-medium">{t("asOf")}</span><input type="date" name="au" defaultValue={asOf} required className={control} /></label>
        <button type="submit" className={`min-h-11 rounded-md border border-stone-300 px-4 text-sm font-medium hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800 ${FOCUS}`}>{t("apply")}</button>
        <a href={`${base}/export?${new URLSearchParams({ au: asOf })}`} className={`inline-flex min-h-11 items-center rounded-md border border-stone-300 px-4 text-sm font-medium hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800 ${FOCUS}`}>{t("export")}</a>
      </form>
      <p className="text-sm" role="status">{t("balanceAsOf", { date: asOf })}</p>
      {empty ? <p>{t("balanceEmpty")}</p> : (
        <div className="overflow-x-auto">
          <table className={TABLE_CLASS}>
            <caption className="sr-only">{t("balanceTitle")} · {asOf}</caption>
            <SectionRows title={t("currentAssets")} section={sheet.currentAssets} totalLabel={t("total")} locale={locale} />
            <SectionRows title={t("fixedAssets")} section={sheet.fixedAssets} totalLabel={t("total")} locale={locale} hideEmpty />
            <SectionRows title={t("otherAssets")} section={sheet.otherAssets} totalLabel={t("total")} locale={locale} hideEmpty />
            <FigureRow label={t("totalAssets")} cents={sheet.totalAssetsCents} locale={locale} strong />
            <SectionRows title={t("currentLiabilities")} section={sheet.currentLiabilities} totalLabel={t("total")} locale={locale} />
            <SectionRows title={t("longTermLiabilities")} section={sheet.longTermLiabilities} totalLabel={t("total")} locale={locale} hideEmpty />
            <FigureRow label={t("totalLiabilities")} cents={sheet.totalLiabilitiesCents} locale={locale} />
            <tbody>
              <tr><th scope="colgroup" colSpan={2} className="border-b border-stone-300 bg-stone-50 px-4 py-3 text-left font-semibold dark:border-stone-700 dark:bg-stone-900">{t("equity")}</th></tr>
              {sheet.equity.lines.map((line) => (
                <tr key={line.accountId}>
                  <td className={TD_CLASS}><span className="font-mono">{line.code}</span> – {accountName(line, locale)}</td>
                  <td className={`${TD_CLASS} ${amount}`}>{formatMoney(line.cents, locale)}</td>
                </tr>
              ))}
              {fiscalYearStart === null ? (
                <tr><td className={TD_CLASS}>{t("cumulativeEarnings")}</td><td className={`${TD_CLASS} ${amount}`}>{formatMoney(sheet.priorEarningsCents + sheet.currentEarningsCents, locale)}</td></tr>
              ) : (
                <>
                  <tr><td className={TD_CLASS}>{t("priorEarnings")}</td><td className={`${TD_CLASS} ${amount}`}>{formatMoney(sheet.priorEarningsCents, locale)}</td></tr>
                  <tr><td className={TD_CLASS}>{t("currentEarnings")}</td><td className={`${TD_CLASS} ${amount}`}>{formatMoney(sheet.currentEarningsCents, locale)}</td></tr>
                </>
              )}
              <tr><th scope="row" className={`${TD_CLASS} text-left font-semibold`}>{t("totalEquity")}</th><td className={`${TD_CLASS} ${amount} font-semibold`}>{formatMoney(sheet.totalEquityCents, locale)}</td></tr>
            </tbody>
            <FigureRow label={t("totalLiabilitiesAndEquity")} cents={sheet.totalLiabilitiesAndEquityCents} locale={locale} strong />
          </table>
        </div>
      )}
      <p role="status" className={`text-sm ${sheet.balanced ? "text-green-800 dark:text-green-300" : "font-semibold text-red-800 dark:text-red-300"}`}>{sheet.balanced ? t("balanced") : t("notBalanced")}</p>
    </section>
  );
}
