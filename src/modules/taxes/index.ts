export * from "./domain/calculation";
export * from "./service/configuration";
export { getOfficialCodeComparison } from "./service/official-comparison";
export { compareOfficialCode } from "./domain/official-comparison";
export type { ComparableCode } from "./domain/official-comparison";
export { getOfficialTaxPreview, importOfficialTaxes } from "./service/official-sources";
export { PROVINCES, CRA_URL, CRA_PAGE, RQ_URL, COVERAGE_FROM, officialScope, parseCraRates, parseRqRates } from "./domain/official-sources";
export type { Province, OfficialRate, OfficialPreview } from "./domain/official-sources";
