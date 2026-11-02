import { StatementPrint } from "../_statement-print";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { FOCUS } from "@/app/_components/focus";
import { TABLE_CLASS } from "@/app/_components/table";
import { statementPeriod } from "@/app/_lib/report-period";
import { listFiscalYears, todayIso } from "@/modules/ledger";
import { getIncomeStatement } from "@/modules/reports";
import { loadCompany } from "../_lib";
import { FigureRow, SectionRows } from "../_statement-table";

export const dynamic = "force-dynamic";

export async function generateMetadata() { return { title: (await getTranslations("statements"))("incomeTitle") }; }

export default async function IncomeStatementPage({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { company, actor, locale } = await loadCompany(params, "ledger.read");
  const t = await getTranslations("statements");
  const c = await getTranslations("incomeComparison");
  const years = await listFiscalYears(actor);
  const query = await searchParams;
  const { from, to } = statementPeriod(query, years, todayIso());
  const { statement } = await getIncomeStatement(actor, { from, to });
  const base = `/c/${company.id}/resultats`;
  const control = `min-h-11 rounded-md border border-stone-300 bg-white px-3 dark:border-stone-700 dark:bg-stone-900 ${FOCUS}`;
  const link = `inline-flex min-h-11 items-center rounded px-2 text-sm underline ${FOCUS}`;
  const empty = [statement.operatingRevenue, statement.costOfSales, statement.operatingExpenses, statement.otherRevenue, statement.otherExpenses].every((part) => part.lines.length === 0);
  return (
    <section className="statement-print space-y-5">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("incomeTitle")}</h1>
        <p className="text-sm text-stone-600 dark:text-stone-400">{t("incomeIntro")}</p>
      </div>
      <StatementPrint companyName={company.name} />
      <Link className={`print-controls inline-flex min-h-11 items-center underline ${FOCUS}`} href={`/c/${company.id}/resultats/comparer?${new URLSearchParams({du:from,au:to})}`}>{c("open")}</Link>
      <form key={`${from}|${to}`} method="get" className="print-controls flex flex-wrap items-end gap-3">
        <label className="text-sm"><span className="mb-1 block font-medium">{t("from")}</span><input type="date" name="du" defaultValue={from} required className={control} /></label>
        <label className="text-sm"><span className="mb-1 block font-medium">{t("to")}</span><input type="date" name="au" defaultValue={to} required className={control} /></label>
        <button type="submit" className={`min-h-11 rounded-md border border-stone-300 px-4 text-sm font-medium hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800 ${FOCUS}`}>{t("apply")}</button>
        <a href={`${base}/export?${new URLSearchParams({ du: from, au: to })}`} className={`inline-flex min-h-11 items-center rounded-md border border-stone-300 px-4 text-sm font-medium hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800 ${FOCUS}`}>{t("export")}</a>
      </form>
      {years.length > 0 ? (
        <p className="print-controls flex flex-wrap items-center gap-x-1 text-sm">
          <span>{t("fiscalYears")}</span>
          {years.map((year) => <Link key={year.id} href={`${base}?${new URLSearchParams({ du: year.start, au: year.end })}`} className={link}>{year.start} → {year.end}</Link>)}
        </p>
      ) : null}
      <p className="text-sm" role="status">{t("period", { from, to })}</p>
      {empty ? <p>{t("incomeEmpty")}</p> : (
        <div className="overflow-x-auto">
          <table className={TABLE_CLASS}>
            <caption className="sr-only">{t("incomeTitle")} · {from} → {to}</caption>
            <SectionRows title={t("operatingRevenue")} section={statement.operatingRevenue} totalLabel={t("total")} locale={locale} />
            <SectionRows title={t("costOfSales")} section={statement.costOfSales} totalLabel={t("total")} locale={locale} hideEmpty />
            <FigureRow label={t("grossProfit")} cents={statement.grossProfitCents} locale={locale} />
            <SectionRows title={t("operatingExpenses")} section={statement.operatingExpenses} totalLabel={t("total")} locale={locale} />
            <FigureRow label={t("operatingIncome")} cents={statement.operatingIncomeCents} locale={locale} />
            <SectionRows title={t("otherRevenue")} section={statement.otherRevenue} totalLabel={t("total")} locale={locale} hideEmpty />
            <SectionRows title={t("otherExpenses")} section={statement.otherExpenses} totalLabel={t("total")} locale={locale} hideEmpty />
            <FigureRow label={t("netIncome")} cents={statement.netIncomeCents} locale={locale} strong />
          </table>
        </div>
      )}
    </section>
  );
}
