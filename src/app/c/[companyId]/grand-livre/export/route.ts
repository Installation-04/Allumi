import { getTranslations } from "next-intl/server";
import { statementPeriod } from "@/app/_lib/report-period";
import { listFiscalYears, todayIso } from "@/modules/ledger";
import { getLedgerExport, ledgerCsv } from "@/modules/reports";
import { loadCompany } from "../../_lib";
import { validId } from "../../factures/editor";

export const dynamic = "force-dynamic";

/** The ledger of one account (`compte` in the address) or of every account, over the period in the address, as a CSV file a spreadsheet opens. */
export async function GET(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const { actor, locale } = await loadCompany(params);
  const t = await getTranslations("ledgerReport");
  const query = Object.fromEntries(new URL(request.url).searchParams);
  const { from, to } = statementPeriod(query, await listFiscalYears(actor), todayIso());
  const accountId = query.compte && validId(query.compte) ? query.compte : null;
  const ledgers = await getLedgerExport(actor, { accountId, from, to });
  const labels = { code: t("code"), account: t("accountName"), date: t("date"), entry: t("entry"), description: t("description"), contact: t("contact"), debit: t("debit"), credit: t("credit"), balance: t("balance"), opening: t("opening"), closing: t("closing") };
  const body = ledgerCsv(ledgers, { from, to }, t("title"), labels, locale);
  const scope = accountId ? ledgers[0]?.account.code ?? "compte" : t("allFile");
  return new Response(`﻿${body}`, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${t("file")}_${scope}_${from}_${to}.csv"`, "Cache-Control": "no-store" },
  });
}
