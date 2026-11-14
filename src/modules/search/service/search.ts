import "server-only";
import { requireRole } from "@/modules/companies";
import { withCompany, type CompanyContext } from "@/platform/tenant";
import type { Locale } from "@/modules/ledger/client";
import { hasSearchCriteria, parseSearchFilters, SEARCH_MAX_PAGE, SEARCH_PAGE_SIZE, type SearchKind, type SearchStatus, type SearchRow } from "../domain/search";

type Row = { id: string; kind: SearchKind; reference: string | null; name: string | null; date: string | null; amount: string | null; status: SearchStatus; journal_id: string | null };

/** Company-scoped search; permissions and data share a single statement snapshot, in addition to RLS. */
export async function searchCompany(actor: CompanyContext, params: Record<string, string | string[] | undefined>, locale: Locale) {
  const filters = parseSearchFilters(params, locale);
  return withCompany(actor, async (tx) => {
    await requireRole(tx, "company.read");
    if (!hasSearchCriteria(filters)) return { filters, rows: [] as SearchRow[], hasMore: false, capped: false };
    const pattern = `%${filters.query.replace(/[\\%_]/g, "\\$&")}%`;
    const rows = await tx.$queryRaw<Row[]>`
      WITH access AS (
        SELECT app_module_level('contacts')<>'none' AS contacts,
          app_module_level('catalog')<>'none' AS catalog,
          app_module_level('sales')<>'none' AS sales,
          app_module_level('accounting')<>'none' AS accounting
      ), records AS (
        SELECT c.id,'CONTACT'::text AS kind,NULL::text AS reference,c.display_name AS name,
          NULL::date AS date,NULL::bigint AS amount,
          CASE WHEN c.is_active THEN 'ACTIVE' ELSE 'ARCHIVED' END AS status,
          concat_ws(' ',c.display_name,c.legal_name,c.email,c.phone) AS terms,NULL::uuid AS journal_id
        FROM contact c CROSS JOIN access a WHERE c.company_id=${actor.companyId}::uuid AND a.contacts
        UNION ALL
        SELECT i.id,'ITEM',i.code,i.name,NULL::date,NULL::bigint,
          CASE WHEN i.is_active THEN 'ACTIVE' ELSE 'ARCHIVED' END,concat_ws(' ',i.code,i.name),NULL::uuid
        FROM item i CROSS JOIN access a WHERE i.company_id=${actor.companyId}::uuid AND a.catalog
        UNION ALL
        SELECT d.id,d.kind::text,d.number,
          coalesce(d.billing_snapshot->>'name',CASE WHEN a.contacts THEN c.display_name END),d.issue_date,d.total_cents,d.status::text,
          concat_ws(' ',d.number,d.reference,d.billing_snapshot->>'name',CASE WHEN a.contacts THEN c.display_name END),d.journal_entry_id
        FROM sales_document d CROSS JOIN access a
        LEFT JOIN contact c ON a.contacts AND c.company_id=d.company_id AND c.id=d.contact_id
        WHERE d.company_id=${actor.companyId}::uuid AND a.sales
        UNION ALL
        SELECT e.id,'ESTIMATE',e.number,coalesce(e.customer_snapshot->>'name',CASE WHEN a.contacts THEN c.display_name END),e.issue_date,e.total_cents,e.status,
          concat_ws(' ',e.number,e.reference,e.customer_snapshot->>'name',CASE WHEN a.contacts THEN c.display_name END),NULL::uuid
        FROM sales_estimate e CROSS JOIN access a
        LEFT JOIN contact c ON a.contacts AND c.company_id=e.company_id AND c.id=e.contact_id
        WHERE e.company_id=${actor.companyId}::uuid AND a.sales
        UNION ALL
        SELECT d.id,d.kind::text,d.number,
          coalesce(d.supplier_snapshot->>'name',d.payee_name,CASE WHEN a.contacts THEN c.display_name END),d.document_date,d.total_cents,d.status::text,
          concat_ws(' ',d.number,d.supplier_reference,d.supplier_snapshot->>'name',d.payee_name,CASE WHEN a.contacts THEN c.display_name END),d.journal_entry_id
        FROM purchase_document d CROSS JOIN access a
        LEFT JOIN contact c ON a.contacts AND c.company_id=d.company_id AND c.id=d.contact_id
        WHERE d.company_id=${actor.companyId}::uuid AND a.accounting
        UNION ALL
        SELECT p.id,CASE WHEN p.ledger='RECEIVABLE' THEN CASE WHEN p.direction='RECEIVED' THEN 'RECEIPT' ELSE 'REFUND' END
          ELSE CASE WHEN p.direction='SENT' THEN 'DISBURSEMENT' ELSE 'SUPPLIER_REFUND' END END,p.number,
          CASE WHEN a.contacts THEN c.display_name END,p.payment_date,p.amount_cents,p.status::text,
          concat_ws(' ',p.number,p.reference,CASE WHEN a.contacts THEN c.display_name END),p.journal_entry_id
        FROM payment p CROSS JOIN access a
        LEFT JOIN contact c ON a.contacts AND c.company_id=p.company_id AND c.id=p.contact_id
        WHERE p.company_id=${actor.companyId}::uuid AND a.accounting AND (p.ledger='PAYABLE' OR a.sales)
      ) SELECT id,kind,reference,name,to_char(date,'YYYY-MM-DD') AS date,amount::text,status,journal_id FROM records
      WHERE (${filters.kind}::text IS NULL OR kind=${filters.kind})
        AND (${filters.status}::text IS NULL OR status=${filters.status})
        AND (${filters.from}::date IS NULL OR date>=${filters.from}::date)
        AND (${filters.to}::date IS NULL OR date<=${filters.to}::date)
        AND (${filters.amountCents?.toString() ?? null}::bigint IS NULL OR amount=${filters.amountCents?.toString() ?? null}::bigint)
        AND (${filters.query}='' OR terms ILIKE ${pattern} OR amount=${filters.queryCents?.toString() ?? null}::bigint OR to_char(date,'YYYY-MM-DD')=${filters.query})
      ORDER BY date DESC NULLS LAST,kind,id LIMIT ${SEARCH_PAGE_SIZE + 1} OFFSET ${(filters.page - 1) * SEARCH_PAGE_SIZE}`;
    const base = `/c/${actor.companyId}`;
    const mapped = rows.slice(0, SEARCH_PAGE_SIZE).map((row): SearchRow => {
      const draft = row.status === "DRAFT";
      const route = row.kind === "CONTACT" ? `contacts/${row.id}` : row.kind === "ITEM" ? `catalogue/${row.id}`
        : row.kind === "ESTIMATE" ? `devis/${row.id}`
        : row.kind === "INVOICE" ? `factures/${draft ? "" : "validees/"}${row.id}`
        : row.kind === "CREDIT_NOTE" ? `avoirs/${draft ? "" : "valides/"}${row.id}`
        : row.kind === "BILL" ? `achats/${draft ? "" : "validees/"}${row.id}`
        : row.kind === "SUPPLIER_CREDIT" ? `credits-fournisseurs/${draft ? "" : "valides/"}${row.id}`
        : row.kind === "EXPENSE" ? `depenses/${draft ? "" : "validees/"}${row.id}`
        : row.kind === "RECEIPT" ? `encaissements/${row.id}` : row.kind === "REFUND" ? `remboursements/${row.id}`
        : row.kind === "DISBURSEMENT" ? `decaissements/${row.id}` : `journal/${row.journal_id}`;
      return { id: row.id, kind: row.kind, reference: row.reference, name: row.name, date: row.date, amountCents: row.amount === null ? null : BigInt(row.amount), status: row.status, href: `${base}/${route}` };
    });
    return { filters, rows: mapped, hasMore: rows.length > SEARCH_PAGE_SIZE && filters.page < SEARCH_MAX_PAGE, capped: rows.length > SEARCH_PAGE_SIZE && filters.page === SEARCH_MAX_PAGE };
  });
}
