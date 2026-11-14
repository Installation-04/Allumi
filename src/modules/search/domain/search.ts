import { isValidIsoDate, parseMoney, type Locale } from "@/modules/ledger/client";

export const SEARCH_KINDS = ["CONTACT", "ITEM", "ESTIMATE", "INVOICE", "CREDIT_NOTE", "BILL", "SUPPLIER_CREDIT", "EXPENSE", "RECEIPT", "REFUND", "DISBURSEMENT", "SUPPLIER_REFUND"] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];
export const SEARCH_STATUSES = ["DRAFT", "SENT", "ACCEPTED", "DECLINED", "CANCELLED", "CONVERTED", "POSTED", "VOID", "ACTIVE", "ARCHIVED"] as const;
export type SearchStatus = (typeof SEARCH_STATUSES)[number];
export const SEARCH_PAGE_SIZE = 50;
export const SEARCH_MAX_PAGE = 100;
export type SearchFilters = {
  query: string; kind: SearchKind | null; status: (typeof SEARCH_STATUSES)[number] | null;
  from: string | null; to: string | null; amountCents: bigint | null; queryCents: bigint | null; page: number;
};

/** Reject ambiguous scopes instead of silently discarding a user's advanced filters. */
export function parseSearchFilters(params: Record<string, string | string[] | undefined>, locale: Locale): SearchFilters {
  for (const key of ["q", "type", "statut", "du", "au", "montant", "page"])
    if (Array.isArray(params[key])) throw new RangeError("search.filter");
  const value = (key: string) => (params[key] as string | undefined)?.trim() ?? "";
  const query = value("q"), kind = value("type"), status = value("statut"), from = value("du"), to = value("au"), amount = value("montant"), page = value("page");
  if (amount.length > 32 || query.length > 120 || /[\u0000-\u001f\u007f]/.test(query) || (kind && !SEARCH_KINDS.includes(kind as SearchKind)) || (status && !SEARCH_STATUSES.includes(status as SearchStatus)) || (from && !isValidIsoDate(from)) || (to && !isValidIsoDate(to)) || (from && to && from > to) || (page && (!/^[1-9]\d{0,2}$/.test(page) || Number(page) > SEARCH_MAX_PAGE))) throw new RangeError("search.filter");
  // Both Canadian formats have disjoint grouping/decimal grammars; preserve exact filters across a language switch.
  const money = (value: string) => parseMoney(value, locale) ?? parseMoney(value, locale === "en" ? "fr-CA" : "en");
  const amountCents = amount ? money(amount) : null;
  if (amount && (amountCents === null || amountCents < 0n)) throw new RangeError("search.filter");
  return { query, kind: kind as SearchKind || null, status: status as SearchFilters["status"] || null, from: from || null, to: to || null, amountCents, queryCents: money(query), page: page ? Number(page) : 1 };
}

export function hasSearchCriteria(filters: SearchFilters) {
  return Boolean(filters.query || filters.kind || filters.status || filters.from || filters.to || filters.amountCents !== null);
}
export type SearchRow = { id: string; kind: SearchKind; reference: string | null; name: string | null; date: string | null; amountCents: bigint | null; status: SearchStatus; href: string };
