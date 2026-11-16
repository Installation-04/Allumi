import { decimalUnits, effectiveRate, type DatedRate } from "./calculation";
import type { OfficialPreview } from "./official-sources";

export type ComparableCode = {
  code: string; nameFr: string; nameEn: string; isActive: boolean; treatment: string;
  components: { code: string; nameFr: string; nameEn: string; isActive: boolean; rates: DatedRate[] }[];
};

export type OfficialComparisonStatus = "NON_STANDARD" | "INACTIVE" | "MISSING_RATE" | "MATCH" | "DIFFERENT";

/** Compare individual rates as a multiset, never just their sum or guessed provider names. */
export function compareOfficialCode(code: ComparableCode, preview: OfficialPreview) {
  const components = code.components.map(part => {
    let rate: string | null = null;
    try { rate = effectiveRate(part.rates, preview.date); } catch { /* Missing/ambiguous coverage is not zero. */ }
    return { code: part.code, nameFr: part.nameFr, nameEn: part.nameEn, isActive: part.isActive, rate };
  });
  const expected = preview.sources.map(source => ({ provider: source.id, rate: effectiveRate(source.rates, preview.date) }));
  const units = (rates: string[]) => rates.map(rate => decimalUnits(rate).toString()).sort();
  const matches = JSON.stringify(units(components.flatMap(part => part.rate === null ? [] : [part.rate]))) === JSON.stringify(units(expected.map(part => part.rate)));
  const status: OfficialComparisonStatus = code.treatment !== "STANDARD" ? "NON_STANDARD"
    : !code.isActive || components.some(part => !part.isActive) ? "INACTIVE"
    : components.some(part => part.rate === null) ? "MISSING_RATE"
    : matches ? "MATCH" : "DIFFERENT";
  return { code: code.code, nameFr: code.nameFr, nameEn: code.nameEn, isActive: code.isActive, treatment: code.treatment, components, expected, status };
}
