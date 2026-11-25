import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "@/platform/i18n/server";
import { getBudgetComparison, getMonthlyBudget } from "@/modules/budgets";
import { formatMoney } from "@/modules/ledger";
import { AppError } from "@/platform/errors";
import { budgetPeriod } from "@/app/_lib/budget-period";
import { TABLE_CLASS, TH_CLASS, TD_CLASS } from "@/app/_components/table";
import { FOCUS } from "@/app/_components/focus";
import { loadCompany, accountName } from "../../_lib";
import { StatementPrint } from "../../_statement-print";

/** The existing services return a complete bounded report from one SQL snapshot; printing performs no writes. */
export async function BudgetPrintView({ params, searchParams, monthly = false }: {
  params: Promise<{ companyId: string; budgetId: string }>;
  searchParams?: Promise<{ periode?: string | string[] }>;
  monthly?: boolean;
}) {
  const { company, actor, locale } = await loadCompany(params, "ledger.read"), { budgetId } = await params;
  const t = await getTranslations("budgets"), p = await getTranslations("budgetPrint");
  let r;
  try {
    r = monthly ? await getMonthlyBudget(actor, budgetId, budgetPeriod((await searchParams)?.periode)) : await getBudgetComparison(actor, budgetId);
  } catch (e) {
    if (e instanceof AppError && ["budgets.notFound", "budgets.monthlyPeriod"].includes(e.key)) notFound();
    if (e instanceof AppError && ["budgets.tooMany", "budgets.monthlyPeriods"].includes(e.key)) return <section><h1 className="text-2xl font-semibold">{p(monthly ? "monthlyTitle" : "annualTitle")}</h1><p role="alert">{(await getTranslations("errors"))(e.key as "budgets.tooMany")}</p></section>;
    throw e;
  }
  const selected = "selected" in r ? r.selected : null, base = `/c/${company.id}/budgets/${budgetId}`;
  const back = selected ? `${base}/mensuel?periode=${selected.id}` : base;
  const money = (value: bigint | null) => value === null ? t("notSet") : formatMoney(value, locale);
  const missing = r.revenue.unbudgeted + r.expenses.unbudgeted;
  return <section className="budget-print statement-print statement-print-comparison min-w-0 space-y-5 break-words">
    <StatementPrint companyName={company.name}/>
    <div className="print-controls space-y-2"><Link className={`inline-flex min-h-11 items-center underline ${FOCUS}`} href={back}>{p("back")}</Link><p className="font-semibold">{company.name}</p><p className="text-sm">{p("hint")}</p></div>
    <h1 className="text-2xl font-semibold">{p(monthly ? "monthlyTitle" : "annualTitle")}</h1>
    <p className="font-semibold">{r.name}</p><p className="text-sm">{p("fiscalYear",{from:r.from,to:r.to})}</p>
    {selected && <p className="font-medium">{t("monthlyRange",{number:selected.number,from:selected.from,to:selected.to})}</p>}
    <p className="text-sm">{p("revision",{revision:r.revision})}</p>
    <p className="text-sm">{t(selected ? "monthlyScope" : "scope")}</p><p className="text-sm">{t("differenceHint")}</p>
    {missing > 0 && <p role="status" className="rounded border border-amber-500 p-3 text-sm">{t("coverage",{count:missing})}</p>}
    <div className="budget-print-summary grid gap-3 sm:grid-cols-2">{(["revenue","expenses"] as const).map(k=><article key={k} className="min-w-0 rounded border border-stone-300 p-4 dark:border-stone-700"><h2 className="font-semibold">{t(k)}</h2><dl className="mt-3 space-y-2 text-sm"><div className="flex flex-wrap justify-between gap-2"><dt>{t("definedTargets")}</dt><dd className="tabular-nums">{money(r[k].targetCents)}</dd></div><div className="flex flex-wrap justify-between gap-2"><dt>{t("actual")}</dt><dd className="tabular-nums">{money(r[k].actualCents)}</dd></div></dl></article>)}</div>
    <section aria-labelledby="budget-print-table"><h2 id="budget-print-table" className="text-lg font-semibold">{t(selected ? "monthlyComparison" : "comparison")}</h2>
      <p className="my-3 text-sm">{p("rowCount",{count:r.rows.length})}</p>
      {r.rows.length === 0 ? <p>{t("noTargets")}</p> : <div className="overflow-x-auto"><table className={`${TABLE_CLASS} min-w-[52rem]`}><caption className="sr-only">{t(selected ? "monthlyComparison" : "comparison")}</caption>
        <colgroup>{(selected ? ["w-[26%]","w-[10%]","w-[12%]","w-[12%]","w-[12%]","w-[12%]","w-[16%]"] : ["w-[40%]","w-[12%]","w-[16%]","w-[16%]","w-[16%]"]).map((width,i)=><col key={i} className={width}/>)}</colgroup>
        <thead><tr>{(["account","type",selected ? "monthlyTarget" : "target","actual","difference",...(selected ? ["target" as const,"monthlyAllocation" as const] : [])] as const).map((key,i)=><th scope="col" key={i} className={TH_CLASS}>{t(key)}</th>)}</tr></thead>
        <tbody>{r.rows.map(a=><tr key={a.accountId}><th scope="row" className={`${TD_CLASS} text-left font-medium`}>{a.code} · {accountName(a,locale)}{!a.isActive && <span className="block text-xs">{t("inactive")}</span>}</th><td className={TD_CLASS}>{t(a.type === "REVENUE" ? "revenue" : "expenses")}</td><td className={`${TD_CLASS} tabular-nums`}>{money(a.targetCents)}</td><td className={`${TD_CLASS} tabular-nums`}>{money(a.actualCents)}</td><td className={`${TD_CLASS} tabular-nums`}>{a.differenceCents === null ? "—" : money(a.differenceCents)}</td>
          {selected && "allocation" in a && <><td className={`${TD_CLASS} tabular-nums`}>{money(a.annualCents)}</td><td className={TD_CLASS}>{a.allocation ? <div className="space-y-1 text-xs"><p>{t("monthlyDefined",{count:a.allocation.definedCount})}</p><p>{t("monthlyRemaining")}: {money(a.allocation.remainingCents)}</p>{a.allocation.complete && <p>{t("monthlyComplete")}</p>}</div> : t("notSet")}</td></>}
        </tr>)}</tbody>
      </table></div>}
    </section>
    <p className="text-sm">{p("limits")}</p>
  </section>;
}
