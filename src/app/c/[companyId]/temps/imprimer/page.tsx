import Link from "next/link";
import { getTranslations } from "@/platform/i18n/server";
import { AppError } from "@/platform/errors";
import { todayIso } from "@/modules/ledger";
import { getTimeLog, timeFilters, timeQuery, duration } from "@/modules/time";
import { TABLE_CLASS, TH_CLASS, TD_CLASS } from "@/app/_components/table";
import { FOCUS } from "@/app/_components/focus";
import { loadCompany } from "../../_lib";
import { StatementPrint } from "../../_statement-print";

export const dynamic = "force-dynamic";
export async function generateMetadata() {
  return { title: (await getTranslations("time"))("printTitle") };
}

/** Read a complete bounded snapshot on opening; the browser prints the displayed values without a write. */
export default async function Page({ params, searchParams }: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { company, actor, locale } = await loadCompany(params, "time.read");
  const t = await getTranslations("time"), base = `/c/${company.id}/temps`;
  let filters;
  try { filters = timeFilters(await searchParams, todayIso()); }
  catch { return <section className="space-y-4"><h1 className="text-2xl font-semibold">{t("printTitle")}</h1><p role="alert">{(await getTranslations("errors"))("time.filters")}</p><Link className={`inline-flex min-h-11 items-center underline ${FOCUS}`} href={base}>{t("reset")}</Link></section>; }
  const back = `${base}?${timeQuery(filters, filters.page)}`;
  let report;
  try { report = await getTimeLog(actor, filters, { forPrint: true }); }
  catch (error) {
    if (!(error instanceof AppError) || !["time.printLimit", "time.limit"].includes(error.key)) throw error;
    return <section className="space-y-4"><h1 className="text-2xl font-semibold">{t("printTitle")}</h1><p role="alert">{(await getTranslations("errors"))(error.key as "time.printLimit")}</p><Link className={`inline-flex min-h-11 items-center underline ${FOCUS}`} href={back}>{t("back")}</Link></section>;
  }
  return <section className="time-print statement-print statement-print-comparison min-w-0 space-y-5 break-words">
    <StatementPrint companyName={company.name} showCurrency={false}/>
    <div className="print-controls space-y-2"><Link className={`inline-flex min-h-11 items-center underline ${FOCUS}`} href={back}>{t("back")}</Link><p className="font-semibold">{company.name}</p><p className="text-sm">{t("printHint")}</p></div>
    <h1 className="text-2xl font-semibold">{t("printTitle")}</h1>
    <p className="text-sm">{t("period", { from: filters.from, to: filters.to, count: report.count })}</p>
    <dl className="time-print-summary grid gap-3 sm:grid-cols-3">
      {([["BILLABLE", report.billableMinutes], ["NON_BILLABLE", report.nonBillableMinutes], ["total", report.billableMinutes + report.nonBillableMinutes]] as const).map(([key, minutes]) => <div key={key} className="min-w-0 rounded border border-stone-300 p-3 dark:border-stone-700"><dt className="text-sm">{t(key)}</dt><dd className="mt-2 font-semibold tabular-nums">{duration(minutes, locale)}</dd></div>)}
    </dl>
    <p className="text-sm">{t("project")}: {filters.project || t("allProjects")} · {t("usage")}: {t(filters.usage)}</p>
    <p className="text-sm">{t("shared")}</p>
    {report.rows.length === 0 ? <p>{t("empty")}</p> : <div className="overflow-x-auto"><table className={`${TABLE_CLASS} min-w-[56rem] table-fixed [overflow-wrap:anywhere]`}>
      <caption className="sr-only">{t("title")}</caption>
      <colgroup>{["w-[11%]", "w-[14%]", "w-[10%]", "w-[17%]", "w-[17%]", "w-[19%]", "w-[12%]"].map((width, i) => <col key={i} className={width}/>)}</colgroup>
      <thead><tr>{(["date", "project", "usage", "person", "task", "notes", "duration"] as const).map(key => <th scope="col" key={key} className={TH_CLASS}>{t(key)}</th>)}</tr></thead>
      <tbody>{report.rows.map(entry => <tr key={entry.id}><th scope="row" className={`${TD_CLASS} text-left font-medium`}>{entry.date}</th><td className={TD_CLASS}>{entry.project}</td><td className={TD_CLASS}>{t(entry.usage)}</td><td className={TD_CLASS}>{entry.person}</td><td className={TD_CLASS}>{entry.task}</td><td className={TD_CLASS}>{entry.notes || "—"}</td><td className={`${TD_CLASS} tabular-nums`}>{duration(entry.minutes, locale)}</td></tr>)}</tbody>
    </table></div>}
    <p className="text-sm">{t("printLimits")}</p>
  </section>;
}
