import "server-only";
import { requireRole } from "@/modules/companies";
import { isValidIsoDate } from "@/modules/ledger";
import { AppError } from "@/platform/errors";
import { withCompany, type CompanyContext } from "@/platform/tenant";
import { buildAging, type Aging, type AgingItem } from "../domain/aging";

const iso = (date: Date): string => date.toISOString().slice(0, 10);

export type ReceivablesAging = Aging & {
  asOf: string;
  /** The balance the ledger holds at that day on the receivable accounts: the aging should add up to it. */
  controlCents: bigint;
  /** The ledger's balance less the aging's total: zero unless a journal entry was written straight on the receivable accounts. */
  differenceCents: bigint;
};

type ItemRow = { kind: AgingItem["kind"]; id: string; contact_id: string; contact_name: string; number: string | null; date: Date; due_date: Date | null; open_cents: bigint };

/**
 * What customers owed at the end of a day, as it stood then: every invoice posted by that day and not yet voided,
 * with what was still open (payments and credits applied after the day do not count), by days past due; and, apart,
 * the credit notes and the payments not yet applied to an invoice that day. The total is checked against the balance of
 * the receivable accounts. Read by whoever reads the ledger and the sales.
 */
export async function getReceivablesAging(actor: CompanyContext, input: { asOf: string }): Promise<ReceivablesAging> {
  if (!isValidIsoDate(input.asOf)) throw new AppError("reports.period");
  return withCompany(actor, async (tx) => {
    await requireRole(tx, "ledger.read");
    await requireRole(tx, "sales.read");
    const rows = await tx.$queryRaw<ItemRow[]>`
      SELECT * FROM (
        SELECT d.kind::text AS kind, d.id, d.contact_id, c.display_name AS contact_name, d.number, d.issue_date AS date, d.due_date,
               sales_document_open_cents(d.company_id, d.id, ${input.asOf}::date) AS open_cents
          FROM sales_document d
          JOIN contact c ON c.company_id = d.company_id AND c.id = d.contact_id
          LEFT JOIN journal_entry v ON v.company_id = d.company_id AND v.id = d.void_entry_id
         WHERE d.company_id = ${actor.companyId}::uuid AND d.status IN ('POSTED', 'VOID') AND d.posting_date <= ${input.asOf}::date
           AND (d.void_entry_id IS NULL OR v.entry_date > ${input.asOf}::date)
        UNION ALL
        SELECT CASE WHEN p.direction = 'RECEIVED' THEN 'PAYMENT' ELSE 'REFUND' END, p.id, p.contact_id, c.display_name, p.number, p.payment_date, NULL::date,
               payment_open_cents(p.company_id, p.id, ${input.asOf}::date)
          FROM payment p
          JOIN contact c ON c.company_id = p.company_id AND c.id = p.contact_id
          LEFT JOIN journal_entry v ON v.company_id = p.company_id AND v.id = p.void_entry_id
         WHERE p.company_id = ${actor.companyId}::uuid AND p.ledger = 'RECEIVABLE' AND p.payment_date <= ${input.asOf}::date
           AND (p.void_entry_id IS NULL OR v.entry_date > ${input.asOf}::date)
      ) open_items WHERE open_cents <> 0`;
    const items: AgingItem[] = rows.map((row) => ({
      kind: row.kind, id: row.id, contactId: row.contact_id, contactName: row.contact_name, number: row.number, date: iso(row.date),
      dueDate: row.due_date ? iso(row.due_date) : null,
      // An invoice or a refund not yet applied adds to what the customer owes; a credit note or a payment not yet applied takes away.
      cents: row.kind === "INVOICE" || row.kind === "REFUND" ? row.open_cents : -row.open_cents,
    }));
    const aging = buildAging(items, input.asOf);
    const [control] = await tx.$queryRaw<{ debit: bigint; credit: bigint }[]>`
      SELECT coalesce(sum(l.debit_cents), 0)::bigint AS debit, coalesce(sum(l.credit_cents), 0)::bigint AS credit
        FROM journal_line l JOIN account a ON a.company_id = l.company_id AND a.id = l.account_id
       WHERE l.company_id = ${actor.companyId}::uuid AND a.subtype = 'ACCOUNTS_RECEIVABLE' AND l.entry_date <= ${input.asOf}::date`;
    const controlCents = (control?.debit ?? 0n) - (control?.credit ?? 0n);
    return { ...aging, asOf: input.asOf, controlCents, differenceCents: controlCents - aging.totalCents };
  });
}
