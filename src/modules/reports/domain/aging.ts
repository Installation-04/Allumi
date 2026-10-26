import type { Locale } from "@/modules/ledger/client";
import { csvFormatFor, toCsv, type CsvCell } from "./csv";

/** How late an open invoice is, by the days since it fell due. An invoice not yet due is "current". */
export const AGE_BUCKETS = ["current", "d1_30", "d31_60", "d61_90", "d91_plus"] as const;
export type AgeBucket = (typeof AGE_BUCKETS)[number];

const MS_PER_DAY = 86_400_000;

/** Whole days from the due date to the day of the report: zero or negative while the invoice is not yet due. Both are YYYY-MM-DD. */
export function daysPastDue(dueDate: string, asOf: string): number {
  // Two UTC midnights are a whole number of days apart (no daylight saving time in UTC): the division is exact.
  return (Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / MS_PER_DAY;
}

/** The bucket of an invoice that is this many days past due: not yet due or due today, 1 to 30, 31 to 60, 61 to 90, more than 90. */
export function ageBucket(days: number): AgeBucket {
  if (days <= 0) return "current";
  if (days <= 30) return "d1_30";
  if (days <= 60) return "d31_60";
  if (days <= 90) return "d61_90";
  return "d91_plus";
}

/** What a customer's account holds at a day, one item at a time: an invoice still open, a credit note or a payment not yet applied. */
export type AgingItem = {
  kind: "INVOICE" | "CREDIT_NOTE" | "PAYMENT" | "REFUND";
  id: string;
  contactId: string;
  contactName: string;
  /** The document's number (`F-00012`, `AV-00003`, `E-00007`), when it has one. */
  number: string | null;
  date: string;
  dueDate: string | null;
  /** What it adds to the customer's balance: an invoice or a refund not yet applied adds, a credit note or a payment not yet applied takes away. */
  cents: bigint;
};

export type AgingBuckets = Record<AgeBucket, bigint>;

export type AgingCustomer = {
  contactId: string;
  contactName: string;
  /** Open invoices by days past due. */
  buckets: AgingBuckets;
  /** Credit notes and payments not yet applied to an invoice (negative), refunds not yet applied (positive): not aged. */
  unappliedCents: bigint;
  totalCents: bigint;
  items: (AgingItem & { daysPastDue: number | null; bucket: AgeBucket | null })[];
};

export type Aging = { customers: AgingCustomer[]; buckets: AgingBuckets; unappliedCents: bigint; totalCents: bigint };

const emptyBuckets = (): AgingBuckets => ({ current: 0n, d1_30: 0n, d31_60: 0n, d61_90: 0n, d91_plus: 0n });

/**
 * Groups what customers owe (and are owed) at a day: per customer, the open invoices in buckets by days past due
 * (their due date, or their own date when they have none) and, apart, the credits and payments not yet applied.
 * Customers are listed by name, each one's items by due date, and every total is exact.
 */
export function buildAging(items: readonly AgingItem[], asOf: string): Aging {
  const byContact = new Map<string, AgingCustomer>();
  for (const item of items) {
    const customer = byContact.get(item.contactId) ?? { contactId: item.contactId, contactName: item.contactName, buckets: emptyBuckets(), unappliedCents: 0n, totalCents: 0n, items: [] };
    if (item.kind === "INVOICE") {
      const days = daysPastDue(item.dueDate ?? item.date, asOf);
      const bucket = ageBucket(days);
      customer.buckets[bucket] += item.cents;
      customer.items.push({ ...item, daysPastDue: days, bucket });
    } else {
      customer.unappliedCents += item.cents;
      customer.items.push({ ...item, daysPastDue: null, bucket: null });
    }
    customer.totalCents += item.cents;
    byContact.set(item.contactId, customer);
  }
  const customers = [...byContact.values()].sort((a, b) => a.contactName.localeCompare(b.contactName) || (a.contactId < b.contactId ? -1 : 1));
  const order = { INVOICE: 0, CREDIT_NOTE: 1, REFUND: 2, PAYMENT: 3 } as const;
  for (const customer of customers) customer.items.sort((a, b) => order[a.kind] - order[b.kind] || (a.dueDate ?? a.date).localeCompare(b.dueDate ?? b.date) || (a.number ?? "").localeCompare(b.number ?? "") || (a.id < b.id ? -1 : 1));
  const buckets = emptyBuckets();
  for (const customer of customers) for (const bucket of AGE_BUCKETS) buckets[bucket] += customer.buckets[bucket];
  return {
    customers, buckets,
    unappliedCents: customers.reduce((sum, customer) => sum + customer.unappliedCents, 0n),
    totalCents: customers.reduce((sum, customer) => sum + customer.totalCents, 0n),
  };
}

/** The words of the aging file, in the language of the person who exports it. */
export type AgingLabels = {
  customer: string;
  document: string;
  number: string;
  date: string;
  dueDate: string;
  daysPastDue: string;
  current: string;
  d1_30: string;
  d31_60: string;
  d61_90: string;
  d91_plus: string;
  unapplied: string;
  total: string;
  kinds: Record<AgingItem["kind"], string>;
  totalLine: string;
};

/**
 * The aging as a flat CSV file: one row per open invoice (in its bucket, with its days past due) and per credit note,
 * refund or payment not yet applied (in the not-applied column), then a total row. Amounts are exact.
 */
export function agingCsv(aging: Aging, asOf: string, title: string, labels: AgingLabels, locale: Locale): string {
  const blank = Array<string>(12).fill("");
  const rows: CsvCell[][] = [
    [title, ...blank],
    [asOf, ...blank],
    [labels.customer, labels.document, labels.number, labels.date, labels.dueDate, labels.daysPastDue, labels.current, labels.d1_30, labels.d31_60, labels.d61_90, labels.d91_plus, labels.unapplied, labels.total],
  ];
  for (const customer of aging.customers) {
    for (const item of customer.items) {
      const cells: Record<AgeBucket, bigint> = emptyBuckets();
      if (item.bucket) cells[item.bucket] = item.cents;
      rows.push([
        customer.contactName, labels.kinds[item.kind], item.number ?? "", item.date, item.dueDate ?? "", item.daysPastDue === null ? "" : String(item.daysPastDue),
        cells.current, cells.d1_30, cells.d31_60, cells.d61_90, cells.d91_plus, item.bucket ? 0n : item.cents, item.cents,
      ]);
    }
  }
  rows.push([labels.totalLine, "", "", "", "", "", aging.buckets.current, aging.buckets.d1_30, aging.buckets.d31_60, aging.buckets.d61_90, aging.buckets.d91_plus, aging.unappliedCents, aging.totalCents]);
  return toCsv(rows, csvFormatFor(locale));
}
