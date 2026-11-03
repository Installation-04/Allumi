import "server-only";
import { requireRole } from "@/modules/companies";
import { formatNumber, isValidIsoDate } from "@/modules/ledger";
import { AppError } from "@/platform/errors";
import { withCompany, type CompanyContext } from "@/platform/tenant";
import {
  customerStatementBalance,
  type CustomerStatement,
  type CustomerStatementKind,
} from "../domain/customer-statement";

export const CUSTOMER_STATEMENT_PAGE_SIZE = 100;
export const CUSTOMER_STATEMENT_EXPORT_LIMIT = 200_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Input = { contactId: string; from: string; to: string; page?: number };
type Detail = {
  id: string;
  entry_id: string;
  entry_number: string;
  date: string;
  kind: CustomerStatementKind;
  source_id: string | null;
  source_number: string | null;
  debit: string;
  credit: string;
  balance: string;
};
type Result = {
  id: string;
  display_name: string;
  legal_name: string | null;
  is_active: boolean;
  opening: string;
  debit: string;
  credit: string;
  n: number;
  page: number;
  page_count: number;
  details: Detail[];
  prefix: string;
  padding: number;
};

export function getCustomerStatement(
  actor: CompanyContext,
  input: Input,
): Promise<CustomerStatement> {
  return readStatement(actor, input, false, CUSTOMER_STATEMENT_EXPORT_LIMIT);
}
export function getCustomerStatementExport(
  actor: CompanyContext,
  input: Omit<Input, "page">,
  options: { maxLines?: number } = {},
): Promise<CustomerStatement> {
  const limit = options.maxLines ?? CUSTOMER_STATEMENT_EXPORT_LIMIT;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 0 ||
    limit > CUSTOMER_STATEMENT_EXPORT_LIMIT
  )
    throw new AppError("reports.tooManyLines");
  return readStatement(actor, input, true, limit);
}

async function readStatement(
  actor: CompanyContext,
  input: Input,
  all: boolean,
  maxLines: number,
): Promise<CustomerStatement> {
  if (!UUID.test(input.contactId)) throw new AppError("reports.contact");
  if (
    !isValidIsoDate(input.from) ||
    !isValidIsoDate(input.to) ||
    input.from > input.to
  )
    throw new AppError("reports.period");
  const page =
    Number.isSafeInteger(input.page) && input.page! > 0
      ? Math.min(input.page!, 100_000)
      : 1;
  return withCompany(actor, async (tx) => {
    await requireRole(tx, "ledger.read");
    await requireRole(tx, "sales.read");
    await requireRole(tx, "contact.read");
    // One SQL statement gives identity, opening, totals, pagination and running balances one MVCC snapshot.
    // Every posted AR line remains present, including paid documents and later reversal entries.
    const [r] = await tx.$queryRaw<Result[]>`
      WITH customer AS (
        SELECT id, display_name, legal_name, is_active FROM contact
        WHERE company_id=${actor.companyId}::uuid AND id=${input.contactId}::uuid AND is_customer
      ), ar AS (
        SELECT l.* FROM journal_line l JOIN account a ON a.company_id=l.company_id AND a.id=l.account_id
        JOIN customer c ON c.id=l.contact_id
        WHERE l.company_id=${actor.companyId}::uuid AND a.subtype='ACCOUNTS_RECEIVABLE' AND l.entry_date<=${input.to}::date
      ), totals AS (
        SELECT coalesce(sum(debit_cents-credit_cents) FILTER(WHERE entry_date<${input.from}::date),0) AS opening,
          coalesce(sum(debit_cents) FILTER(WHERE entry_date>=${input.from}::date),0) AS debit,
          coalesce(sum(credit_cents) FILTER(WHERE entry_date>=${input.from}::date),0) AS credit,
          count(*) FILTER(WHERE entry_date>=${input.from}::date)::int AS n FROM ar
      ), pages AS (
        SELECT *, greatest(1,ceil(n::numeric/${CUSTOMER_STATEMENT_PAGE_SIZE})::int) AS page_count,
          CASE WHEN ${all} THEN 1 ELSE least(${page},greatest(1,ceil(n::numeric/${CUSTOMER_STATEMENT_PAGE_SIZE})::int)) END AS page FROM totals
      ), movements AS (
        SELECT l.id,l.entry_id,e.entry_number::text AS entry_number,to_char(l.entry_date,'YYYY-MM-DD') AS date,l.line_no,
          CASE WHEN e.reverses_entry_id IS NOT NULL THEN 'REVERSAL'
            WHEN d.kind='INVOICE' THEN 'INVOICE' WHEN d.kind='CREDIT_NOTE' THEN 'CREDIT_NOTE'
            WHEN p.direction='RECEIVED' THEN 'RECEIPT' WHEN p.direction='SENT' THEN 'REFUND' ELSE 'ADJUSTMENT' END AS kind,
          coalesce(d.id,p.id) AS source_id,coalesce(d.number,p.number) AS source_number,
          l.debit_cents::text AS debit,l.credit_cents::text AS credit,
          ((SELECT opening FROM totals)+sum(l.debit_cents-l.credit_cents) OVER(ORDER BY l.entry_date,e.entry_number,l.line_no ROWS UNBOUNDED PRECEDING))::text AS balance
        FROM ar l JOIN journal_entry e ON e.company_id=l.company_id AND e.id=l.entry_id
        LEFT JOIN journal_entry original ON original.company_id=e.company_id AND original.id=e.reverses_entry_id
        LEFT JOIN sales_document d ON d.company_id=e.company_id AND d.journal_entry_id=coalesce(original.id,e.id)
        LEFT JOIN payment p ON p.company_id=e.company_id AND p.journal_entry_id=coalesce(original.id,e.id) AND p.ledger='RECEIVABLE'
        WHERE l.entry_date>=${input.from}::date
      ) SELECT c.*,p.opening::text,p.debit::text,p.credit::text,p.n,p.page,p.page_count,
        coalesce((SELECT jsonb_agg(m ORDER BY m.date,m.entry_number::bigint,m.line_no) FROM (
          SELECT * FROM movements WHERE NOT ${all} OR (SELECT n FROM totals)<=${maxLines}
          ORDER BY date,entry_number::bigint,line_no LIMIT ${all ? maxLines : CUSTOMER_STATEMENT_PAGE_SIZE}
          OFFSET (CASE WHEN ${all} THEN 0 ELSE (SELECT (page-1)*${CUSTOMER_STATEMENT_PAGE_SIZE} FROM pages) END)
        ) m),'[]') AS details,
        coalesce((SELECT prefix FROM number_sequence WHERE company_id=${actor.companyId}::uuid AND key='JOURNAL_ENTRY'),'') AS prefix,
        coalesce((SELECT padding FROM number_sequence WHERE company_id=${actor.companyId}::uuid AND key='JOURNAL_ENTRY'),0) AS padding
      FROM customer c CROSS JOIN pages p`;
    if (!r) throw new AppError("reports.contact");
    if (all && r.n > maxLines) throw new AppError("reports.tooManyLines");
    const openingCents = BigInt(r.opening),
      debitCents = BigInt(r.debit),
      creditCents = BigInt(r.credit);
    return {
      contact: {
        id: r.id,
        displayName: r.display_name,
        legalName: r.legal_name,
        isActive: r.is_active,
      },
      from: input.from,
      to: input.to,
      openingCents,
      debitCents,
      creditCents,
      closingCents: customerStatementBalance(
        openingCents,
        debitCents,
        creditCents,
      ),
      rows: r.details.map((row) => ({
        id: row.id,
        entryId: row.entry_id,
        entryNumber: formatNumber(
          r.prefix,
          r.padding,
          BigInt(row.entry_number),
        ),
        date: row.date,
        kind: row.kind,
        sourceId: row.source_id,
        sourceNumber: row.source_number,
        debitCents: BigInt(row.debit),
        creditCents: BigInt(row.credit),
        balanceCents: BigInt(row.balance),
      })),
      lineCount: r.n,
      page: r.page,
      pageCount: all ? 1 : r.page_count,
    };
  });
}

/** Bounded customer picker; historical statements also support archived customers. */
export async function listStatementCustomers(
  actor: CompanyContext,
  query = "",
) {
  const term = query
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 120)
    .replace(/[\\%_]/g, "\\$&");
  return withCompany(actor, async (tx) => {
    await requireRole(tx, "ledger.read");
    await requireRole(tx, "sales.read");
    await requireRole(tx, "contact.read");
    const rows = await tx.contact.findMany({
      where: {
        companyId: actor.companyId,
        isCustomer: true,
        ...(term
          ? { displayName: { contains: term, mode: "insensitive" as const } }
          : {}),
      },
      select: { id: true, displayName: true, isActive: true },
      orderBy: [{ displayName: "asc" }, { id: "asc" }],
      take: 101,
    });
    return { contacts: rows.slice(0, 100), hasMore: rows.length > 100 };
  });
}
