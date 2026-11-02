"use client";

import { useTranslations } from "next-intl";
import { FOCUS } from "@/app/_components/focus";

/** Print the already authorized report, without fetching or recalculating its balances. */
export function StatementPrint({ companyName }: { companyName: string }) {
  const t = useTranslations("statementPrint");
  return <>
    <div className="statement-print-heading hidden">
      <p className="text-lg font-semibold">{companyName}</p>
      <p className="text-sm">{t("currency")}</p>
    </div>
    <div className="print-controls flex flex-wrap items-start gap-3">
      <button type="button" onClick={() => window.print()} className={`inline-flex min-h-11 items-center rounded-md border border-stone-300 px-4 text-sm font-medium hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800 ${FOCUS}`}>{t("print")}</button>
      <details className="max-w-xl"><summary className={`inline-flex min-h-11 cursor-pointer items-center rounded px-2 text-sm underline ${FOCUS}`}>{t("tips")}</summary><p className="mt-2 text-sm text-stone-600 dark:text-stone-400">{t("hint")}</p></details>
    </div>
  </>;
}
