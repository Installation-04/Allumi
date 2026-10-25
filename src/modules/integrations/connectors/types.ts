import type { SkipReason, ImportedTransaction } from "../domain/transaction";
import type { MappedSession } from "../domain/online-payment";
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

export type PaymentLinkInput = { linkId: string; amountCents: bigint; currency: string; name: string };

/**
 * What a service does to take a payment for an invoice on a page it hosts: no public address on our side, we ask
 * and look. Built per call, like a `Connector`. Each creating call is idempotent on the link id, so a retry after a
 * lost answer finds what the first one made instead of making a second.
 */
export type PaymentConnector = {
  /** The price of a payment for exactly this amount; returns the service's id for it. */
  createPrice(input: PaymentLinkInput): Promise<string>;
  /** The payment page for a price, good for one completed payment. */
  createLink(input: { linkId: string; priceId: string; description: string }): Promise<{ id: string; url: string }>;
  /** The page stops taking payments. */
  deactivateLink(externalId: string): Promise<void>;
  /** The payments made on a page: those settled, and how many are still on their way. */
  listPayments(externalId: string): Promise<{ payments: MappedSession[]; waiting: number }>;
};
