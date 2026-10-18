import { getTranslations } from "next-intl/server";
import { ActionForm, Field, TABLE_CLASS, TD_CLASS, TH_CLASS } from "@/app/_components/ui";
import { can } from "@/modules/companies";
import { listFiscalYears } from "@/modules/ledger";
import { loadCompany } from "../_lib";
import { closeYearAction, createYearAction, lockPeriodAction, reopenPeriodAction, reopenYearAction } from "./actions";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return { title: (await getTranslations("fiscal"))("title") };
}

export default async function FiscalPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { company, actor } = await loadCompany(params);
  const t = await getTranslations("fiscal");
  const years = await listFiscalYears(actor);
  const role = company.role;

  return (
    <section className="space-y-8">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      {can(role, "period.reopen") ? <p className="text-sm text-stone-700 dark:text-stone-300">{t("reopenHint")}</p> : null}

      {can(role, "fiscalYear.create") ? <ActionForm action={createYearAction.bind(null, company.id)} label={t("createNext")} /> : null}

      {years.map((year) => {
        const locked = year.periods.filter((period) => period.status === "LOCKED").length;
        const allLocked = locked === year.periods.length;
        return (
          <article key={year.id} className="space-y-4 rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900" aria-labelledby={`year-${year.id}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id={`year-${year.id}`} className="text-lg font-semibold">
                {t("year", { start: year.start, end: year.end })}
              </h2>
              <p className="text-sm">
                <span className="rounded bg-stone-200 px-2 py-0.5 dark:bg-stone-800">{year.status === "OPEN" ? t("open") : t("closed")}</span>{" "}
                {t("lockedPeriods", { locked, total: year.periods.length })}
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className={TABLE_CLASS}>
                <thead>
                  <tr>
                    <th scope="col" className={TH_CLASS}>{t("period")}</th>
                    <th scope="col" className={TH_CLASS}>{t("range")}</th>
                    <th scope="col" className={TH_CLASS}>{t("status")}</th>
                    <th scope="col" className={TH_CLASS}>{t("actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {year.periods.map((period) => (
                    <tr key={period.id}>
                      <td className={`${TD_CLASS} tabular-nums`}>{period.number}</td>
                      <td className={`${TD_CLASS} tabular-nums`}>
                        {period.start} → {period.end}
                      </td>
                      <td className={TD_CLASS}>{period.status === "LOCKED" ? t("locked") : t("openPeriod")}</td>
                      <td className={TD_CLASS}>
                        {period.status === "OPEN" && year.status === "OPEN" && can(role, "period.lock") ? <ActionForm action={lockPeriodAction.bind(null, company.id, period.id)} label={t("lock")} /> : null}
                        {period.status === "LOCKED" && year.status === "OPEN" && can(role, "period.reopen") ? (
                          <ActionForm action={reopenPeriodAction.bind(null, company.id, period.id)} label={t("reopen")}>
                            <Field name="reason" label={t("reason")} autoComplete="off" />
                          </ActionForm>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {year.status === "OPEN" && can(role, "fiscalYear.close") ? (
              <div className="space-y-1">
                <ActionForm action={closeYearAction.bind(null, company.id, year.id)} label={t("close")} />
                {allLocked ? null : <p className="text-xs text-stone-600 dark:text-stone-400">{t("closeHint")}</p>}
              </div>
            ) : null}
            {year.status === "CLOSED" && can(role, "fiscalYear.reopen") ? (
              <ActionForm action={reopenYearAction.bind(null, company.id, year.id)} label={t("reopenYear")}>
                <Field name="reason" label={t("reason")} autoComplete="off" />
              </ActionForm>
            ) : null}
          </article>
        );
      })}
    </section>
  );
}
