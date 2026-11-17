import { getTranslations } from "@/platform/i18n/server";
import { exportDisbursements } from "@/modules/payments";
import { toCsv, csvFormatFor, type CsvCell } from "@/modules/reports";
import { AppError } from "@/platform/errors";
import { loadCompany } from "../../_lib";
import { resolvePaymentHistoryFilters } from "../../_payment-history";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const { actor, locale } = await loadCompany(params, "ledger.read");
  const search = new URL(request.url).searchParams;
  const query = Object.fromEntries([...new Set(search.keys())].map((key) => {
    const values = search.getAll(key);
    return [key, values.length === 1 ? values[0] : values];
  }));
  const filters = resolvePaymentHistoryFilters(query);
  const t = await getTranslations("supplierPaymentHistory");
  const p = await getTranslations("disbursements");
  const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
  try {
    const payments = await exportDisbursements(actor, filters);
    const columns = ["number", "date", "supplier", "amount", "status", "method", "reference", "currency"] as const;
    const rows: CsvCell[][] = [columns.map((key) => t(key)), ...payments.map((row) => [
      row.number, row.date, row.supplier || t("supplierUnavailable"), row.amountCents,
      p(`statuses.${row.status}`), p(`methods.${row.method}`), row.reference ?? "", "CAD",
    ])];
    return new Response(`\uFEFF${toCsv(rows, csvFormatFor(locale))}`, { headers: {
      ...headers, "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="supplier_payments.csv"',
    } });
  } catch (error) {
    if (!(error instanceof AppError) || error.key !== "disbursements.exportLimit") throw error;
    const e = await getTranslations("errors");
    return new Response(e(error.key), { status: 422, headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" } });
  }
}
