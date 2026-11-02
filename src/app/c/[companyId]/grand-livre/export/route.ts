import { can } from "@/modules/companies";
import { notFound } from "next/navigation";
import { resolveLedgerContact } from "../../_ledger-contact";
import { getTranslations } from "next-intl/server";
import { statementPeriod } from "@/app/_lib/report-period";
import { listFiscalYears, todayIso } from "@/modules/ledger";
import { getLedgerExport, ledgerCsv } from "@/modules/reports";
import { loadCompany } from "../../_lib";
import { reportAccountId } from "@/app/_lib/report-account";
import { AppError } from "@/platform/errors";

export const dynamic = "force-dynamic";

/** The ledger of one account (`compte` in the address) or of every account, over the period in the address, as a CSV file a spreadsheet opens. */
export async function GET(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const { actor, locale,company } = await loadCompany(params, "ledger.read");
  const t = await getTranslations("ledgerReport");
  const query = Object.fromEntries(new URL(request.url).searchParams);
  const { from, to } = statementPeriod(query, await listFiscalYears(actor), todayIso());
  const ids=new URL(request.url).searchParams.getAll("compte");
  const accountId = reportAccountId(ids.length?ids:undefined)??null;
  if(query.contact&&!can(company,"contact.read"))notFound();
  const contactValues=new URL(request.url).searchParams.getAll("contact");
  const contact=await resolveLedgerContact(actor,contactValues.length?contactValues:undefined);
  const ledgers = await getLedgerExport(actor, { accountId, from, to,contactId:contact?.id }).catch(e=>{if(e instanceof AppError&&e.key==="reports.account")notFound();throw e;});
  const labels = { code: t("code"), account: t("accountName"), date: t("date"), entry: t("entry"), description: t("description"), contact: t("contact"), debit: t("debit"), credit: t("credit"), balance: t("balance"), opening: t("opening"), closing: t("closing") };
  const body = ledgerCsv(ledgers, { from, to,contactName:contact?.displayName }, t("title"), labels, locale);
  const scope = accountId ? ledgers[0]?.account.code ?? "compte" : t("allFile");
  return new Response(`﻿${body}`, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${t("file")}_${scope}${contact?"_contact":""}_${from}_${to}.csv"`, "Cache-Control": "private, no-store" },
  });
}
