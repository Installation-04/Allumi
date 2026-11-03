import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { can } from "@/modules/companies";
import { listFiscalYears, todayIso } from "@/modules/ledger";
import {
  getCustomerStatementExport,
  toCsv,
  csvFormatFor,
  type CsvCell,
} from "@/modules/reports";
import { AppError } from "@/platform/errors";
import { loadCompany } from "../../_lib";
import { statementFilters } from "../filters";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ companyId: string }> },
) {
  const { actor, company, locale } = await loadCompany(params, "ledger.read");
  if (!can(company, "sales.read") || !can(company, "contact.read")) notFound();
  const url = new URL(request.url),
    query: Record<string, string | string[]> = {};
  for (const key of url.searchParams.keys()) {
    const values = url.searchParams.getAll(key);
    query[key] = values.length === 1 ? values[0]! : values;
  }
  const filters = statementFilters(
    query,
    await listFiscalYears(actor),
    todayIso(),
  );
  if (!filters.contactId) notFound();
  const report = await getCustomerStatementExport(actor, {
    ...filters,
    contactId: filters.contactId,
  }).catch((e) => {
    if (e instanceof AppError && e.key === "reports.contact") notFound();
    throw e;
  });
  const t = await getTranslations("customerStatement");
  const rows: CsvCell[][] = [
    [t("title"), company.name],
    [t("customer"), report.contact.displayName],
    [t("from"), report.from, t("to"), report.to],
    [t("opening"), report.openingCents],
    [],
    [t("date"), t("document"), t("debit"), t("credit"), t("balance")],
    ...report.rows.map((r) => [
      r.date,
      `${t(`kinds.${r.kind}`)}${r.sourceNumber ? ` ${r.sourceNumber}` : ""}`,
      r.debitCents,
      r.creditCents,
      r.balanceCents,
    ]),
    [],
    [t("debit"), report.debitCents, t("credit"), report.creditCents],
    [t("closing"), report.closingCents],
  ];
  return new Response(`\uFEFF${toCsv(rows, csvFormatFor(locale))}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="customer_statement_${report.from}_${report.to}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
