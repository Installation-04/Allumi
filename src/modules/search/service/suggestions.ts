import "server-only";
import type { CompanyContext } from "@/platform/tenant";
import type { Locale } from "@/modules/ledger/client";
import { suggestionQuery, suggestionRows } from "../domain/suggestions";
import { searchCompany } from "./search";

export async function suggestCompany(actor: CompanyContext, value: unknown, locale: Locale) {
  const query = suggestionQuery(value);
  // Even an empty/short term must pass the company authorization in the normal search service.
  const result = await searchCompany(actor, { q: query }, locale);
  return suggestionRows(result.rows);
}
