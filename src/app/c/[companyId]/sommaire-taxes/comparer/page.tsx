import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { can } from "@/modules/companies";
import { listFiscalYears, todayIso, formatMoney } from "@/modules/ledger";
import { getTaxComparison, taxComparisonParams, TAX_COMPARISON_METRICS, type TaxComparison } from "@/modules/reports";
import { TD_CLASS, TH_CLASS } from "@/app/_components/table";
import { FOCUS } from "@/app/_components/focus";
import { loadCompany } from "../../_lib";
import { taxComparisonPeriod, taxComparisonLabels } from "../../_tax-comparison";
import { StatementPrint } from "../../_statement-print";

export const dynamic = "force-dynamic";
export async function generateMetadata() { return { title: (await getTranslations("taxComparison"))("title") }; }

export default async function Page({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<Record<string,string|string[]|undefined>> }) {
  const { company, actor, locale } = await loadCompany(params, "ledger.read"); if (!can(company, "taxes.read")) notFound();
  const t = await getTranslations("taxComparison"), s = await getTranslations("taxSummary");
  const today = todayIso(), periods = taxComparisonPeriod(await searchParams, await listFiscalYears(actor), today);
  const report = await getTaxComparison(actor, periods), labels = taxComparisonLabels(t,s);
  const base = `/c/${company.id}/sommaire-taxes`, query = new URLSearchParams(taxComparisonParams(periods));
  const control = `min-h-11 max-w-full rounded border border-stone-300 bg-white px-3 dark:border-stone-700 dark:bg-stone-900 ${FOCUS}`;
  const button = `inline-flex min-h-11 items-center rounded border px-4 ${FOCUS}`;
  const compactTh = TH_CLASS.replace("px-4", "px-1 sm:px-4"), compactTd = TD_CLASS.replace("px-4", "px-1 sm:px-4");
  const table = (name: string, values: TaxComparison["totals"]) => <div className="overflow-x-auto"><table className="w-full border-collapse text-xs sm:text-sm"><caption className="sr-only">{name}</caption><thead><tr>{[labels.metric,labels.current,labels.reference,labels.difference].map(label => <th scope="col" key={label} className={compactTh}>{label}</th>)}</tr></thead><tbody>{TAX_COMPARISON_METRICS.map(key => <tr key={key}><th scope="row" className={`${compactTd} min-w-20 text-left font-normal`}>{labels[key]}</th>{[values[key].currentCents,values[key].referenceCents,values[key].differenceCents].map((amount,index) => <td key={index} className={`${compactTd} whitespace-nowrap text-right tabular-nums`}>{formatMoney(amount,locale)}</td>)}</tr>)}</tbody></table></div>;
  const agrees = [report.current,report.reference].every(side => side.differenceCents === 0n && side.anomalyCount === 0);
  return <section className="statement-print statement-print-comparison space-y-5">
    <Link className={`print-controls inline-flex min-h-11 items-center underline ${FOCUS}`} href={`${base}?${new URLSearchParams({du:periods.current.from,au:periods.current.to})}`}>{t("back")}</Link>
    <h1 className="text-2xl font-semibold">{t("title")}</h1><p className="text-sm">{t("intro")}</p><StatementPrint companyName={company.name} />
    <form className="print-controls space-y-3" key={query.toString()} method="get"><div className="grid gap-3 md:grid-cols-2">{([["current","du","au",periods.current],["reference","du_ref","au_ref",periods.reference]] as const).map(([key,fromName,toName,period]) => <fieldset key={key} className="min-w-0 rounded border border-stone-300 p-3 dark:border-stone-700"><legend className="px-1 font-semibold">{t(key)}</legend><div className="flex flex-wrap gap-3"><label className="min-w-0"><span className="mb-1 block text-sm">{t(key === "current" ? "currentFrom" : "referenceFrom")}</span><input className={control} name={fromName} type="date" required defaultValue={period.from}/></label><label className="min-w-0"><span className="mb-1 block text-sm">{t(key === "current" ? "currentTo" : "referenceTo")}</span><input className={control} name={toName} type="date" required defaultValue={period.to}/></label></div></fieldset>)}</div><div className="flex flex-wrap gap-3"><button className={button}>{t("apply")}</button><a className={button} href={`${base}/comparer/export?${query}`}>{s("export")}</a></div></form>
    <p role="status" className="text-sm">{t("periods",{from:periods.current.from,to:periods.current.to,referenceFrom:periods.reference.from,referenceTo:periods.reference.to})}</p>
    {[periods.current,periods.reference].some(p => p.to > today) && <p role="status" className="text-sm font-semibold text-amber-800 dark:text-amber-300">{s("inProgress")}</p>}
    <p className="rounded border border-stone-300 p-3 text-sm dark:border-stone-700">{t("scope")}</p>
    <h2 className="text-lg font-semibold">{s("total")}</h2>{table(s("total"),report.totals)}
    {report.taxes.map(tax => <section key={tax.id} className="space-y-2"><h2 className="font-semibold">{tax.code} — {locale === "en" ? tax.nameEn : tax.nameFr}</h2>{table(tax.code,tax.amounts)}</section>)}
    <h2 className="text-lg font-semibold">{t("checks")}</h2><div className="grid gap-4 md:grid-cols-2">{([["current",report.current],["reference",report.reference]] as const).map(([key,side]) => <section key={key} className="space-y-2 rounded border border-stone-300 p-3 dark:border-stone-700"><h3 className="font-semibold">{t(key)}</h3><dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm"><dt>{s("control")}</dt><dd className="text-right tabular-nums">{formatMoney(side.controlCents,locale)}</dd><dt>{t("reconciliation")}</dt><dd className="text-right tabular-nums">{formatMoney(side.differenceCents,locale)}</dd><dt>{s("anomalies")}</dt><dd className="text-right">{side.anomalyCount}</dd><dt>{t("lines")}</dt><dd className="text-right">{side.lineCount}</dd></dl><Link className={`print-controls inline-flex min-h-11 items-center underline ${FOCUS}`} href={`${base}?${new URLSearchParams({du:periods[key].from,au:periods[key].to})}`}>{t("source")}</Link></section>)}</div>
    <p role="status" className={agrees ? "text-sm text-green-800 dark:text-green-300" : "text-sm font-semibold text-red-800 dark:text-red-300"}>{t(agrees ? "agrees" : "warning")}</p>
  </section>;
}
