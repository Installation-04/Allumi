CREATE FUNCTION paid_expense_posting_exact() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE d purchase_document%ROWTYPE;
BEGIN
  IF NEW.source_type <> 'PURCHASE_DOCUMENT' THEN RETURN NULL; END IF;
  SELECT * INTO d FROM purchase_document WHERE company_id=NEW.company_id AND id=NEW.source_id;
  IF NOT FOUND OR d.kind <> 'EXPENSE' THEN RETURN NULL; END IF;
  IF d.status NOT IN ('POSTED', 'VOID') OR d.journal_entry_id IS DISTINCT FROM NEW.id THEN
    RAISE EXCEPTION 'invoice must be posted with its linked entry' USING ERRCODE='AL006';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM account WHERE company_id=d.company_id AND id=d.payment_account_id AND is_active AND subtype IN ('BANK','CASH','CREDIT_CARD')) OR EXISTS (SELECT 1 FROM purchase_document_tax WHERE company_id=d.company_id AND document_id=d.id AND recoverable_cents<>amount_cents) THEN RAISE EXCEPTION 'invalid paid expense payment account or recovery' USING ERRCODE='AL006'; END IF;
  IF EXISTS (
    WITH expected_lines AS (
      SELECT d.payment_account_id AS account_id,NULL::uuid AS contact_id,NULL::uuid AS tax_id,NULL::tax_box AS tax_box,0::bigint AS debit,d.total_cents AS credit
      UNION ALL
      SELECT l.account_id,NULL::uuid,NULL::uuid,NULL::tax_box,l.amount_cents,0::bigint
        FROM purchase_document_line l WHERE l.company_id=d.company_id AND l.document_id=d.id AND l.amount_cents>0
      UNION ALL
      SELECT t.recoverable_account_id,NULL::uuid,dt.tax_id,'RECOVERABLE'::tax_box,dt.recoverable_cents,0::bigint
        FROM purchase_document_tax dt JOIN tax t ON t.company_id=dt.company_id AND t.id=dt.tax_id
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

REVOKE ALL ON FUNCTION paid_expense_posting_exact() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER paid_expense_posting_exact AFTER INSERT ON journal_entry DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW WHEN (NEW.source_type='PURCHASE_DOCUMENT') EXECUTE FUNCTION paid_expense_posting_exact();
