import type { SearchKind, SearchRow } from "./search";

export const SEARCH_SUGGESTION_LIMIT = 8;
export const SEARCH_SUGGESTION_DELAY = 300;
export type SearchSuggestion = { id: string; kind: SearchKind; label: string | null; href: string };

export function suggestionQuery(value: unknown): string {
  if (typeof value !== "string" || value.length > 120 || /[\u0000-\u001f\u007f]/.test(value)) throw new RangeError("search.filter");
  const query = value.trim();
  return [...query].length < 2 ? "" : query;
}

/** Only labels and destinations are exposed; dates, amounts and other result fields stay server-side. */
export function suggestionRows(rows: SearchRow[]): SearchSuggestion[] {
  return rows.slice(0, SEARCH_SUGGESTION_LIMIT).map(row => ({ id: row.id, kind: row.kind, href: row.href,
    label: row.reference && row.name ? `${row.reference} · ${row.name}` : row.reference ?? row.name }));
}
