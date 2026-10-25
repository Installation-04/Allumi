import type { SkipReason, ImportedTransaction } from "../domain/transaction";
import type { Window } from "../domain/windows";
import type { HttpClient } from "./http";

export type ConnectorContext = { sandbox: boolean; http: HttpClient };
export type FetchedWindow = { transactions: ImportedTransaction[]; skipped: Record<SkipReason, number> };

/** One service, for one set of credentials. Built per sync: it may keep what it needs (a token) for that run. */
export type Connector = {
  /** Calls the service once to prove the credentials work. Throws an AppError whose key says why not. */
  verify(): Promise<void>;
  /** Every transaction in [from, to), oldest or newest first (the caller sorts nothing). Throws `integrations.tooMany` when the window holds more than a run can read. */
  fetchWindow(window: Window): Promise<FetchedWindow>;
};

export const emptySkips = (): Record<SkipReason, number> => ({ unsupportedCurrency: 0, notSettled: 0 });
