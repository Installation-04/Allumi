/** What every service's transaction is turned into, so the rest of the application never sees a provider's shape. */
export const TRANSACTION_KINDS = ["PAYMENT", "REFUND", "PAYOUT", "FEE", "DISPUTE", "ADJUSTMENT", "OTHER"] as const;
export type TransactionKind = (typeof TRANSACTION_KINDS)[number];

export type ImportedTransaction = {
  /** Unique per account: `<provider>:<the service's id>`. Importing the same transaction twice is a no-op. */
  externalId: string;
  /** The accounting date (company time zone). */
  date: string;
  /** The effect on the service's balance: gross − fee. This is what a bank statement line would say. */
  amountCents: bigint;
  grossCents: bigint;
  /** Fee charged (positive), or returned (negative). */
  feeCents: bigint;
  /** ISO 4217, upper case. */
  currency: string;
  /** The service's own type: `charge`, `payout`, `T0006`… */
  sourceType: string;
  description: string;
  /** Raw values and the normalized kind, for checking or recomputing. Never personal data. */
  details: Record<string, string | number | boolean | null>;
};

/** Why a record was left out. Counted and shown after a sync; nothing is hidden silently. */
export type SkipReason = "unsupportedCurrency" | "notSettled";

export type Mapped = { ok: true; transaction: ImportedTransaction } | { ok: false; reason: SkipReason };

/**
 * Currencies that do not have two decimals (no cent, or three decimals). Amounts are kept in cents, so these are
 * skipped instead of being scaled wrongly.
 */
export const NON_TWO_DECIMAL_CURRENCIES: ReadonlySet<string> = new Set([
  "BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW", "PYG", "RWF", "UGX", "UYI", "VND", "VUV", "XAF", "XOF", "XPF",
  "BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND",
]);

export const supportsCents = (currency: string) => /^[A-Z]{3}$/.test(currency) && !NON_TWO_DECIMAL_CURRENCIES.has(currency);

/** An amount written as a decimal string ("465.00", "-13.79", "5") in exact cents; null if it is anything else. */
export function decimalToCents(text: string): bigint | null {
  const match = /^(-?)(\d{1,15})(?:\.(\d{1,2})0*)?$/.exec(text.trim());
  if (!match) return null;
  const cents = BigInt(match[2] ?? "0") * 100n + BigInt((match[3] ?? "").padEnd(2, "0") || "0");
  return match[1] === "-" ? -cents : cents;
}

const DAY_FORMAT = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" });

/** The calendar day of an instant in the company's time zone (the application's: America/Toronto), as YYYY-MM-DD. */
export function accountingDate(instant: Date): string {
  return DAY_FORMAT.format(instant);
}

/** A text kept to a length, with no control characters: it ends up on screen and in the audit trail. */
export function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const text = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
