-- Every invoice posting must match its revenue accounts and collected taxes, not just its receivable total.
CREATE FUNCTION invoice_posting_exact() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE d sales_document%ROWTYPE;
BEGIN
  IF NEW.source_type <> 'SALES_DOCUMENT' THEN RETURN NULL; END IF;
  SELECT * INTO d FROM sales_document WHERE company_id=NEW.company_id AND id=NEW.source_id;
  IF NOT FOUND OR d.kind <> 'INVOICE' THEN RETURN NULL; END IF;
  IF d.status NOT IN ('POSTED', 'VOID') OR d.journal_entry_id IS DISTINCT FROM NEW.id THEN
    RAISE EXCEPTION 'invoice must be posted with its linked entry' USING ERRCODE='AL006';
  END IF;
  IF EXISTS (
    WITH expected_lines AS (
      SELECT a.id AS account_id, d.contact_id AS contact_id, NULL::uuid AS tax_id, NULL::tax_box AS tax_box, d.total_cents AS debit, 0::bigint AS credit
        FROM account a WHERE a.company_id=d.company_id AND a.system_key='ACCOUNTS_RECEIVABLE'
      UNION ALL
      SELECT l.account_id,NULL::uuid,NULL::uuid,NULL::tax_box,0,l.amount_cents
        FROM sales_document_line l WHERE l.company_id=d.company_id AND l.document_id=d.id AND l.amount_cents>0
      UNION ALL
      SELECT t.payable_account_id,NULL::uuid,dt.tax_id,'COLLECTED'::tax_box,0,dt.amount_cents
        FROM sales_document_tax dt JOIN tax t ON t.company_id=dt.company_id AND t.id=dt.tax_id
        WHERE dt.company_id=d.company_id AND dt.document_id=d.id AND dt.amount_cents>0
    ), expected AS (
      SELECT account_id,contact_id,tax_id,tax_box,sum(debit) AS debit,sum(credit) AS credit
      FROM expected_lines GROUP BY account_id,contact_id,tax_id,tax_box
    ), actual AS (
      SELECT account_id,contact_id,tax_id,tax_box,sum(debit_cents) AS debit,sum(credit_cents) AS credit
      FROM journal_line WHERE company_id=d.company_id AND entry_id=NEW.id GROUP BY account_id,contact_id,tax_id,tax_box
    )
    (SELECT * FROM expected EXCEPT SELECT * FROM actual)
    UNION ALL
    (SELECT * FROM actual EXCEPT SELECT * FROM expected)
  ) THEN RAISE EXCEPTION 'invoice entry differs from its revenue and tax lines' USING ERRCODE='AL006'; END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION invoice_posting_exact() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER invoice_posting_exact
AFTER INSERT ON journal_entry DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW WHEN (NEW.source_type = 'SALES_DOCUMENT') EXECUTE FUNCTION invoice_posting_exact();
