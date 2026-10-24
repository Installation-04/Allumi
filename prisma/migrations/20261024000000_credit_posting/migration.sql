-- Every invoice posting must match its revenue accounts and collected taxes, not just its receivable total.
CREATE OR REPLACE FUNCTION invoice_posting_exact() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE d sales_document%ROWTYPE;
BEGIN
  IF NEW.source_type <> 'SALES_DOCUMENT' THEN RETURN NULL; END IF;
  SELECT * INTO d FROM sales_document WHERE company_id=NEW.company_id AND id=NEW.source_id;
  IF NOT FOUND OR d.kind NOT IN ('INVOICE', 'CREDIT_NOTE') THEN RETURN NULL; END IF;
  IF d.status NOT IN ('POSTED', 'VOID') OR d.journal_entry_id IS DISTINCT FROM NEW.id THEN
    RAISE EXCEPTION 'invoice must be posted with its linked entry' USING ERRCODE='AL006';
  END IF;
  IF EXISTS (
    WITH expected_lines AS (
      SELECT a.id AS account_id, d.contact_id AS contact_id, NULL::uuid AS tax_id, NULL::tax_box AS tax_box, CASE WHEN d.kind='INVOICE' THEN d.total_cents ELSE 0 END AS debit, CASE WHEN d.kind='CREDIT_NOTE' THEN d.total_cents ELSE 0 END AS credit
        FROM account a WHERE a.company_id=d.company_id AND a.system_key='ACCOUNTS_RECEIVABLE'
      UNION ALL
      SELECT l.account_id,NULL::uuid,NULL::uuid,NULL::tax_box,CASE WHEN d.kind='CREDIT_NOTE' THEN l.amount_cents ELSE 0 END,CASE WHEN d.kind='INVOICE' THEN l.amount_cents ELSE 0 END
        FROM sales_document_line l WHERE l.company_id=d.company_id AND l.document_id=d.id AND l.amount_cents>0
      UNION ALL
      SELECT t.payable_account_id,NULL::uuid,dt.tax_id,'COLLECTED'::tax_box,CASE WHEN d.kind='CREDIT_NOTE' THEN dt.amount_cents ELSE 0 END,CASE WHEN d.kind='INVOICE' THEN dt.amount_cents ELSE 0 END
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

-- Linked credit notes preserve source line positions and cannot cumulatively exceed the original invoice.
CREATE FUNCTION credit_note_limits() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE original sales_document%ROWTYPE;
BEGIN
  IF NEW.kind <> 'CREDIT_NOTE' OR OLD.status <> 'DRAFT' OR NEW.status <> 'POSTED' OR NEW.credited_document_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO original FROM sales_document WHERE company_id=NEW.company_id AND id=NEW.credited_document_id FOR UPDATE;
  IF NOT FOUND OR original.kind <> 'INVOICE' OR original.status <> 'POSTED'
     OR NEW.contact_id <> original.contact_id OR NEW.tax_rounding <> original.tax_rounding
     OR NEW.issue_date < original.posting_date OR NEW.posting_date < NEW.issue_date
     OR NEW.subtotal_cents <= 0 THEN
    RAISE EXCEPTION 'invalid linked credit invoice or dates' USING ERRCODE='AL006';
  END IF;
  IF EXISTS (
    SELECT 1 FROM sales_document_line l LEFT JOIN sales_document_line src
      ON src.company_id=l.company_id AND src.document_id=original.id AND src.position=l.position
    WHERE l.company_id=NEW.company_id AND l.document_id=NEW.id
      AND (src.id IS NULL OR l.account_id IS DISTINCT FROM src.account_id OR l.tax_code_id IS DISTINCT FROM src.tax_code_id
        OR l.amount_cents < 0 OR l.amount_cents + coalesce((SELECT sum(prev.amount_cents)
          FROM sales_document_line prev JOIN sales_document d ON d.company_id=prev.company_id AND d.id=prev.document_id
          WHERE d.company_id=NEW.company_id AND d.credited_document_id=original.id AND d.status='POSTED'
            AND d.id<>NEW.id AND prev.position=l.position),0) > src.amount_cents)
  ) OR EXISTS (
    SELECT 1 FROM sales_document_tax t LEFT JOIN sales_document_tax src
      ON src.company_id=t.company_id AND src.document_id=original.id AND src.tax_id=t.tax_id
    WHERE t.company_id=NEW.company_id AND t.document_id=NEW.id
      AND (src.id IS NULL OR t.rate<>src.rate
        OR t.amount_cents + coalesce((SELECT sum(prev.amount_cents)
          FROM sales_document_tax prev JOIN sales_document d ON d.company_id=prev.company_id AND d.id=prev.document_id
          WHERE d.company_id=NEW.company_id AND d.credited_document_id=original.id AND d.status='POSTED'
            AND d.id<>NEW.id AND prev.tax_id=t.tax_id),0) > src.amount_cents)
  ) OR NEW.total_cents + coalesce((SELECT sum(total_cents) FROM sales_document
      WHERE company_id=NEW.company_id AND credited_document_id=original.id AND status='POSTED' AND id<>NEW.id),0) > original.total_cents THEN
    RAISE EXCEPTION 'credit exceeds original lines or taxes' USING ERRCODE='AL006';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION credit_note_limits() FROM PUBLIC;
CREATE TRIGGER credit_note_limits BEFORE UPDATE ON sales_document
FOR EACH ROW WHEN (NEW.kind='CREDIT_NOTE' AND OLD.status='DRAFT' AND NEW.status='POSTED') EXECUTE FUNCTION credit_note_limits();
