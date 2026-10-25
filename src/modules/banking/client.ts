// What a client component may import from banking: the pure domain only (no database, no secrets).
export { csvMappingSchema, type CsvMapping, type RowError } from "./domain/mapping";
export { readStatement, type ReadStatement } from "./domain/read";
export { decodeStatement, MAX_STATEMENT_BYTES, StatementError, type StatementErrorCode } from "./domain/statement";
export { matchProblem, MAX_MATCHED_LINES, type MatchProblem } from "./domain/matching";
