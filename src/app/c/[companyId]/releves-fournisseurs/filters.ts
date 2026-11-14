import { notFound } from "next/navigation";
import { isValidIsoDate } from "@/modules/ledger";
import { statementPeriod } from "@/app/_lib/report-period";
import type { FiscalYearDto } from "@/modules/ledger";

/** Invalid or repeated scopes never broaden a supplier-facing statement. */
export function statementFilters(
  query: Record<string, string | string[] | undefined>,
  years: readonly FiscalYearDto[],
  today: string,
) {
  for (const key of ["contact", "du", "au", "imprimer"])
    if (Array.isArray(query[key])) notFound();
  const contactId = (query.contact as string | undefined)?.trim().toLowerCase();
  if (
    contactId &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      contactId,
    )
  )
    notFound();
  const from = query.du as string | undefined,
    to = query.au as string | undefined;
  if (
    (from || to) &&
    (!isValidIsoDate(from ?? "") || !isValidIsoDate(to ?? "") || from! > to!)
  )
    notFound();
  return { contactId, ...statementPeriod(query, years, today) };
}
