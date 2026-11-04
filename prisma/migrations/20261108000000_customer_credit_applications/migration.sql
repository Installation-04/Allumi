-- Applications only move the open balance: retain the original append-only and
-- deferred amount/contact/status checks, and close their snapshot/history races.
CREATE FUNCTION customer_application_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  document_ids uuid[];
  effective_date date;
  latest_date date;
  period_status period_status;
  document_count integer;
BEGIN
  IF TG_TABLE_NAME = 'payment_allocation' THEN
    IF NEW.sales_document_id IS NULL THEN RETURN NEW; END IF;
    document_ids := ARRAY[NEW.sales_document_id];
  ELSE
    IF app_module_level('sales') <> 'write' OR app_module_level('accounting') <> 'write' THEN
      RAISE EXCEPTION 'customer credit applications require sales and accounting write access' USING ERRCODE = '42501';
    END IF;
    document_ids := ARRAY[NEW.credit_note_id, NEW.invoice_id];
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'customer applications require read committed isolation' USING ERRCODE = 'AL007';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.unapplied_date IS NOT NULL THEN
      RAISE EXCEPTION 'customer applications must be created active' USING ERRCODE = 'AL007';
    END IF;
    effective_date := NEW.applied_date;
  ELSE
    IF OLD.unapplied_date IS NOT NULL OR NEW.unapplied_date IS NULL THEN
      RAISE EXCEPTION 'customer applications can only be unapplied once' USING ERRCODE = 'AL007';
    END IF;
    effective_date := NEW.unapplied_date;
  END IF;
  IF effective_date > (now() AT TIME ZONE 'America/Toronto')::date THEN
    RAISE EXCEPTION 'customer application dates cannot be in the future' USING ERRCODE = 'AL007';
  END IF;

  IF TG_TABLE_NAME = 'payment_allocation' THEN
    PERFORM id FROM payment WHERE company_id = NEW.company_id AND id = NEW.payment_id FOR UPDATE;
  END IF;
  -- Lock before reading dependencies: a concurrent refund/application only locks
  -- documents, without changing their tuple and invalidating an older snapshot.
  PERFORM id FROM sales_document WHERE company_id = NEW.company_id AND id = ANY(document_ids) ORDER BY id FOR UPDATE;
  SELECT count(*) INTO document_count FROM sales_document WHERE company_id = NEW.company_id AND id = ANY(document_ids);
  IF document_count <> cardinality(document_ids) THEN
    RAISE EXCEPTION 'customer application documents are unavailable' USING ERRCODE = 'AL007';
  END IF;
  SELECT max(d) INTO latest_date FROM (
    SELECT posting_date AS d FROM sales_document WHERE company_id = NEW.company_id AND id = ANY(document_ids)
    UNION ALL SELECT applied_date FROM payment_allocation WHERE company_id = NEW.company_id AND sales_document_id = ANY(document_ids)
      AND NOT (TG_TABLE_NAME = 'payment_allocation' AND id = NEW.id)
    UNION ALL SELECT unapplied_date FROM payment_allocation WHERE company_id = NEW.company_id AND sales_document_id = ANY(document_ids)
      AND NOT (TG_TABLE_NAME = 'payment_allocation' AND id = NEW.id)
    UNION ALL SELECT applied_date FROM sales_credit_application WHERE company_id = NEW.company_id AND (credit_note_id = ANY(document_ids) OR invoice_id = ANY(document_ids))
      AND NOT (TG_TABLE_NAME = 'sales_credit_application' AND id = NEW.id)
    UNION ALL SELECT unapplied_date FROM sales_credit_application WHERE company_id = NEW.company_id AND (credit_note_id = ANY(document_ids) OR invoice_id = ANY(document_ids))
      AND NOT (TG_TABLE_NAME = 'sales_credit_application' AND id = NEW.id)
  ) history;
  IF effective_date < latest_date OR effective_date < NEW.applied_date THEN
    RAISE EXCEPTION 'customer application predates a document movement' USING ERRCODE = 'AL007';
  END IF;
  SELECT status INTO period_status FROM fiscal_period
    WHERE company_id = NEW.company_id AND effective_date BETWEEN start_date AND end_date FOR SHARE;
  IF NOT FOUND OR period_status <> 'OPEN' THEN
    RAISE EXCEPTION 'customer application requires an open fiscal period' USING ERRCODE = 'AL003';
  END IF;
  RETURN NEW;
END $$;
-- Alphabetically before existing locks/checks: reject unsupported snapshots
-- before any dependency reads. UPDATE already holds its own application tuple.
CREATE TRIGGER customer_credit_application_guard BEFORE INSERT OR UPDATE ON sales_credit_application
  FOR EACH ROW EXECUTE FUNCTION customer_application_guard();
CREATE TRIGGER customer_payment_allocation_guard BEFORE INSERT OR UPDATE ON payment_allocation
  FOR EACH ROW EXECUTE FUNCTION customer_application_guard();

CREATE FUNCTION customer_document_void_isolation() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.status = 'POSTED' AND NEW.status = 'VOID' AND current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'customer document cancellation requires read committed isolation' USING ERRCODE = 'AL006';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER customer_document_void_isolation BEFORE UPDATE ON sales_document
  FOR EACH ROW EXECUTE FUNCTION customer_document_void_isolation();
REVOKE ALL ON FUNCTION customer_application_guard(), customer_document_void_isolation() FROM PUBLIC;
