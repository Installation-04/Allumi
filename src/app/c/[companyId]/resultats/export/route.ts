import { getTranslations } from "next-intl/server";
import { statementPeriod } from "@/app/_lib/report-period";
import { listFiscalYears, todayIso } from "@/modules/ledger";
import { getIncomeStatement, incomeStatementCsv } from "@/modules/reports";
import { loadCompany } from "../../_lib";
import { statementLabels } from "../../_statements";

export const dynamic = "force-dynamic";

/** The income statement of the period in the address, as a CSV file a spreadsheet opens (UTF-8 with a byte-order mark). */
export async function GET(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const { actor, locale } = await loadCompany(params, "ledger.read");
  const t = await getTranslations("statements");
  const query = Object.fromEntries(new URL(request.url).searchParams);
  const { from, to } = statementPeriod(query, await listFiscalYears(actor), todayIso());
  const { statement } = await getIncomeStatement(actor, { from, to });
  const body = incomeStatementCsv(statement, { from, to }, t("incomeTitle"), statementLabels(t), locale);
  return new Response(`﻿${body}`, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${t("incomeFile")}_${from}_${to}.csv"`, "Cache-Control": "no-store" },
  });
}
