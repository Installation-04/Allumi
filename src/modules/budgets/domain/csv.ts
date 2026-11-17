import { toCsv,csvFormatFor,type CsvCell } from "@/modules/reports/client";
import type { Locale } from "@/modules/ledger/client";
import type { BudgetComparison } from "../service/budgets";
type Label = "title"|"year"|"scope"|"differenceHint"|"code"|"account"|"type"|"target"|"actual"|"difference"|"revenue"|"expenses"|"notSet"|"definedTargets"|"coverage";
export function budgetCsv(r:BudgetComparison,locale:Locale,t:(key:Label,values?:{count:number})=>string):string {
  const rows:CsvCell[][]=[[t("title"),r.name],[t("year"),r.from,r.to],[t("scope")],[t("differenceHint")],[t("code"),t("account"),t("type"),t("target"),t("actual"),t("difference")],
    ...r.rows.map(a=>[a.code,locale==="en"?a.nameEn:a.nameFr,t(a.type==="REVENUE"?"revenue":"expenses"),a.targetCents??t("notSet"),a.actualCents,a.differenceCents??""]),
    [t("revenue"),t("definedTargets"),"",r.revenue.targetCents,r.revenue.actualCents,""],
    [t("expenses"),t("definedTargets"),"",r.expenses.targetCents,r.expenses.actualCents,""]];
  const missing=r.revenue.unbudgeted+r.expenses.unbudgeted;if(missing) rows.push([t("coverage",{count:missing}),String(missing)]);
  return toCsv(rows,csvFormatFor(locale));
}
