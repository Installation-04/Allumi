import { notFound } from "next/navigation";
import { can } from "@/modules/companies";
import { balanceDay } from "@/app/_lib/report-period";
import { todayIso } from "@/modules/ledger";
import { agingCsv, getReceivablesAging } from "@/modules/reports";
import { getTranslations } from "next-intl/server";
import { agingLabels } from "../../_aging";
import { loadCompany } from "../../_lib";

export const dynamic = "force-dynamic";

/** The receivables aging at the day in the address, one row per open item, as a CSV file a spreadsheet opens (UTF-8 with a byte-order mark). */
export async function GET(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const { company, actor, locale } = await loadCompany(params, "ledger.read");
  if (!can(company, "sales.read")) notFound();
  const t = await getTranslations("aging");
  const asOf = balanceDay(Object.fromEntries(new URL(request.url).searchParams), todayIso());
  const aging = await getReceivablesAging(actor, { asOf });
  const body = agingCsv(aging, asOf, t("title"), agingLabels(t), locale);
  return new Response(`﻿${body}`, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${t("file")}_${asOf}.csv"`, "Cache-Control": "no-store" },
  });
}
