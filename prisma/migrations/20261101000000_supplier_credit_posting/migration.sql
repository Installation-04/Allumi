-- Credits reuse the original bill's stored rates, never the current tax schedule.
CREATE FUNCTION purchase_document_taxes_are_exact(d purchase_document) RETURNS boolean
LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
 WITH expected AS (
   SELECT t.tax_id,t.rate,sum(l.amount_cents)::bigint AS base_cents,
     CASE WHEN d.tax_rounding='PER_LINE' THEN sum(round(l.amount_cents*t.rate))
          ELSE round(sum(l.amount_cents*t.rate)) END::bigint AS amount_cents
   FROM purchase_document_line l
   JOIN tax_code_component c ON c.company_id=l.company_id AND c.tax_code_id=l.tax_code_id
   JOIN purchase_document_tax t ON t.company_id=l.company_id AND t.document_id=d.credited_document_id AND t.tax_id=c.tax_id
   WHERE l.company_id=d.company_id AND l.document_id=d.id
   GROUP BY t.tax_id,t.rate
 ), actual AS (
   SELECT tax_id,rate,base_cents,amount_cents FROM purchase_document_tax
   WHERE company_id=d.company_id AND document_id=d.id
 )
 SELECT d.kind='SUPPLIER_CREDIT' AND NOT EXISTS (
   (SELECT * FROM expected EXCEPT SELECT * FROM actual)
   UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM expected)
 ) AND NOT EXISTS (
   SELECT 1 FROM purchase_document_tax WHERE company_id=d.company_id AND document_id=d.id AND recoverable_cents<>amount_cents
 ) AND NOT EXISTS (
   SELECT 1 FROM purchase_document_line l JOIN tax_code_component c ON c.company_id=l.company_id AND c.tax_code_id=l.tax_code_id
   WHERE l.company_id=d.company_id AND l.document_id=d.id AND NOT EXISTS (
     SELECT 1 FROM purchase_document_tax t WHERE t.company_id=l.company_id AND t.document_id=d.credited_document_id AND t.tax_id=c.tax_id
   )
 );
$$;
REVOKE ALL ON FUNCTION purchase_document_taxes_are_exact(purchase_document) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION purchase_document_taxes_are_exact(purchase_document) TO allumi_app;

-- Every invoice posting must match its revenue accounts and collected taxes, not just its receivable total.
CREATE FUNCTION supplier_credit_posting_exact() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE d purchase_document%ROWTYPE;
BEGIN
  IF NEW.source_type <> 'PURCHASE_DOCUMENT' THEN RETURN NULL; END IF;
  SELECT * INTO d FROM purchase_document WHERE company_id=NEW.company_id AND id=NEW.source_id;
  IF NOT FOUND OR d.kind <> 'SUPPLIER_CREDIT' THEN RETURN NULL; END IF;
  IF d.status NOT IN ('POSTED', 'VOID') OR d.journal_entry_id IS DISTINCT FROM NEW.id THEN
    RAISE EXCEPTION 'invoice must be posted with its linked entry' USING ERRCODE='AL006';
  END IF;
  IF EXISTS (
    WITH expected_lines AS (
      SELECT a.id AS account_id, d.contact_id AS contact_id, NULL::uuid AS tax_id, NULL::tax_box AS tax_box, CASE WHEN d.kind='SUPPLIER_CREDIT' THEN d.total_cents ELSE 0 END AS debit, CASE WHEN d.kind='BILL' THEN d.total_cents ELSE 0 END AS credit
        FROM account a WHERE a.company_id=d.company_id AND a.system_key='ACCOUNTS_PAYABLE'
      UNION ALL
      SELECT l.account_id,NULL::uuid,NULL::uuid,NULL::tax_box,CASE WHEN d.kind='BILL' THEN l.amount_cents ELSE 0 END,CASE WHEN d.kind='SUPPLIER_CREDIT' THEN l.amount_cents ELSE 0 END
        FROM purchase_document_line l WHERE l.company_id=d.company_id AND l.document_id=d.id AND l.amount_cents>0
      UNION ALL
      SELECT t.recoverable_account_id,NULL::uuid,dt.tax_id,'RECOVERABLE'::tax_box,CASE WHEN d.kind='BILL' THEN dt.amount_cents ELSE 0 END,CASE WHEN d.kind='SUPPLIER_CREDIT' THEN dt.amount_cents ELSE 0 END
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

-- Linked credit notes preserve source line positions and cannot cumulatively exceed the original invoice.
CREATE FUNCTION supplier_credit_limits() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE original purchase_document%ROWTYPE;
BEGIN
  IF NEW.kind <> 'SUPPLIER_CREDIT' OR OLD.status <> 'DRAFT' OR NEW.status <> 'POSTED' OR NEW.credited_document_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO original FROM purchase_document WHERE company_id=NEW.company_id AND id=NEW.credited_document_id FOR UPDATE;
  IF NOT FOUND OR original.kind <> 'BILL' OR original.status <> 'POSTED'
     OR NEW.contact_id <> original.contact_id OR NEW.tax_rounding <> original.tax_rounding
     OR NEW.document_date < original.posting_date OR NEW.posting_date < NEW.document_date
     OR NEW.subtotal_cents <= 0 THEN
    RAISE EXCEPTION 'invalid linked credit invoice or dates' USING ERRCODE='AL006';
  END IF;
  IF EXISTS (
    SELECT 1 FROM purchase_document_line l LEFT JOIN purchase_document_line src
      ON src.company_id=l.company_id AND src.document_id=original.id AND src.position=l.position
    WHERE l.company_id=NEW.company_id AND l.document_id=NEW.id
      AND (src.id IS NULL OR l.account_id IS DISTINCT FROM src.account_id OR l.tax_code_id IS DISTINCT FROM src.tax_code_id
        OR l.amount_cents < 0 OR l.amount_cents + coalesce((SELECT sum(prev.amount_cents)
          FROM purchase_document_line prev JOIN purchase_document d ON d.company_id=prev.company_id AND d.id=prev.document_id
          WHERE d.company_id=NEW.company_id AND d.credited_document_id=original.id AND d.status='POSTED'
            AND d.id<>NEW.id AND prev.position=l.position),0) > src.amount_cents)
  ) OR EXISTS (
    SELECT 1 FROM purchase_document_tax t LEFT JOIN purchase_document_tax src
      ON src.company_id=t.company_id AND src.document_id=original.id AND src.tax_id=t.tax_id
    WHERE t.company_id=NEW.company_id AND t.document_id=NEW.id
      AND (src.id IS NULL OR t.rate<>src.rate
        OR t.amount_cents + coalesce((SELECT sum(prev.amount_cents)
          FROM purchase_document_tax prev JOIN purchase_document d ON d.company_id=prev.company_id AND d.id=prev.document_id
          WHERE d.company_id=NEW.company_id AND d.credited_document_id=original.id AND d.status='POSTED'
            AND d.id<>NEW.id AND prev.tax_id=t.tax_id),0) > src.amount_cents)
  ) OR NEW.total_cents + coalesce((SELECT sum(total_cents) FROM purchase_document
      WHERE company_id=NEW.company_id AND credited_document_id=original.id AND status='POSTED' AND id<>NEW.id),0) > original.total_cents THEN
    RAISE EXCEPTION 'credit exceeds original lines or taxes' USING ERRCODE='AL006';
  END IF;
  IF EXISTS (SELECT 1 FROM purchase_document_tax WHERE company_id=NEW.company_id AND document_id=original.id AND recoverable_cents<>amount_cents) THEN RAISE EXCEPTION 'partial recovery not supported by supplier credits' USING ERRCODE='AL005'; END IF;
  IF NOT purchase_document_taxes_are_exact(NEW) THEN RAISE EXCEPTION 'supplier credit taxes differ from source rates' USING ERRCODE='AL005'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION supplier_credit_limits() FROM PUBLIC;
CREATE TRIGGER supplier_credit_limits BEFORE UPDATE ON purchase_document
FOR EACH ROW WHEN (NEW.kind='SUPPLIER_CREDIT' AND OLD.status='DRAFT' AND NEW.status='POSTED') EXECUTE FUNCTION supplier_credit_limits();

REVOKE ALL ON FUNCTION supplier_credit_posting_exact() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER supplier_credit_posting_exact
AFTER INSERT ON journal_entry DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW WHEN (NEW.source_type='PURCHASE_DOCUMENT') EXECUTE FUNCTION supplier_credit_posting_exact();
