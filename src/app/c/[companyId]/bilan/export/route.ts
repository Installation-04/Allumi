import { balanceDay } from "@/app/_lib/report-period";
import { todayIso } from "@/modules/ledger";
import { balanceSheetCsv, getBalanceSheet } from "@/modules/reports";
import { getTranslations } from "next-intl/server";
import { loadCompany } from "../../_lib";
import { statementLabels } from "../../_statements";

export const dynamic = "force-dynamic";

/** The balance sheet at the day in the address, as a CSV file a spreadsheet opens (UTF-8 with a byte-order mark). */
export async function GET(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const { actor, locale } = await loadCompany(params);
  const t = await getTranslations("statements");
  const asOf = balanceDay(Object.fromEntries(new URL(request.url).searchParams), todayIso());
  const { sheet } = await getBalanceSheet(actor, asOf);
  const body = balanceSheetCsv(sheet, asOf, t("balanceTitle"), statementLabels(t), locale);
  return new Response(`﻿${body}`, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${t("balanceFile")}_${asOf}.csv"`, "Cache-Control": "no-store" },
  });
}
