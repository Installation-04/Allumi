-- Preserve append-only applications and exact posted entries; serialize changes
-- in availability before inspecting chronology or deferred open balances.
CREATE FUNCTION supplier_application_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  document_ids uuid[];
  source_id uuid;
  effective_date date;
  latest_date date;
  period_state period_status;
  document_count integer;
BEGIN
  IF TG_TABLE_NAME = 'payment_allocation' THEN
    IF NEW.purchase_document_id IS NULL THEN RETURN NEW; END IF;
    document_ids := ARRAY[NEW.purchase_document_id];
  ELSE
    IF app_module_level('accounting') <> 'write' THEN
      RAISE EXCEPTION 'supplier credit applications require accounting write access' USING ERRCODE = '42501';
    END IF;
    document_ids := ARRAY[NEW.supplier_credit_id, NEW.bill_id];
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'supplier applications require read committed isolation' USING ERRCODE = 'AL007';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.unapplied_date IS NOT NULL THEN
      RAISE EXCEPTION 'supplier applications must be created active' USING ERRCODE = 'AL007';
    END IF;
    effective_date := NEW.applied_date;
  ELSE
    IF OLD.unapplied_date IS NOT NULL OR NEW.unapplied_date IS NULL THEN
      RAISE EXCEPTION 'supplier applications can only be unapplied once' USING ERRCODE = 'AL007';
    END IF;
    effective_date := NEW.unapplied_date;
  END IF;
  IF effective_date > (now() AT TIME ZONE 'America/Toronto')::date THEN
    RAISE EXCEPTION 'supplier application dates cannot be in the future' USING ERRCODE = 'AL007';
  END IF;
  IF TG_TABLE_NAME = 'payment_allocation' THEN
    PERFORM id FROM payment WHERE company_id = NEW.company_id AND id = NEW.payment_id FOR UPDATE;
  END IF;
  SELECT credited_document_id INTO source_id FROM purchase_document
    WHERE company_id = NEW.company_id AND id = ANY(document_ids) AND kind = 'SUPPLIER_CREDIT';
  -- Source/target bills precede credits, matching posting and cancellation services.
  PERFORM id FROM purchase_document WHERE company_id = NEW.company_id AND kind = 'BILL'
    AND (id = ANY(document_ids) OR id = source_id) ORDER BY id FOR UPDATE;
  PERFORM id FROM purchase_document WHERE company_id = NEW.company_id AND kind = 'SUPPLIER_CREDIT'
    AND id = ANY(document_ids) ORDER BY id FOR UPDATE;
  SELECT count(*) INTO document_count FROM purchase_document WHERE company_id = NEW.company_id AND id = ANY(document_ids);
  IF document_count <> cardinality(document_ids) THEN
    RAISE EXCEPTION 'supplier application documents are unavailable' USING ERRCODE = 'AL007';
  END IF;
  SELECT max(d) INTO latest_date FROM (
    SELECT posting_date AS d FROM purchase_document WHERE company_id = NEW.company_id AND id = ANY(document_ids)
    UNION ALL SELECT applied_date FROM payment_allocation WHERE company_id = NEW.company_id AND purchase_document_id = ANY(document_ids)
      AND NOT (TG_TABLE_NAME = 'payment_allocation' AND id = NEW.id)
    UNION ALL SELECT unapplied_date FROM payment_allocation WHERE company_id = NEW.company_id AND purchase_document_id = ANY(document_ids)
      AND NOT (TG_TABLE_NAME = 'payment_allocation' AND id = NEW.id)
    UNION ALL SELECT applied_date FROM purchase_credit_application WHERE company_id = NEW.company_id AND (supplier_credit_id = ANY(document_ids) OR bill_id = ANY(document_ids))
      AND NOT (TG_TABLE_NAME = 'purchase_credit_application' AND id = NEW.id)
    UNION ALL SELECT unapplied_date FROM purchase_credit_application WHERE company_id = NEW.company_id AND (supplier_credit_id = ANY(document_ids) OR bill_id = ANY(document_ids))
      AND NOT (TG_TABLE_NAME = 'purchase_credit_application' AND id = NEW.id)
  ) history;
  IF effective_date < latest_date OR effective_date < NEW.applied_date THEN
    RAISE EXCEPTION 'supplier application predates a document movement' USING ERRCODE = 'AL007';
  END IF;
  SELECT status INTO period_state FROM fiscal_period
    WHERE company_id = NEW.company_id AND effective_date BETWEEN start_date AND end_date FOR SHARE;
  IF NOT FOUND OR period_state <> 'OPEN' THEN
    RAISE EXCEPTION 'supplier application requires an open fiscal period' USING ERRCODE = 'AL003';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER supplier_credit_application_guard BEFORE INSERT OR UPDATE ON purchase_credit_application
  FOR EACH ROW EXECUTE FUNCTION supplier_application_guard();
CREATE TRIGGER supplier_payment_allocation_guard BEFORE INSERT OR UPDATE ON payment_allocation
  FOR EACH ROW EXECUTE FUNCTION supplier_application_guard();

CREATE FUNCTION supplier_document_isolation() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF ((OLD.status = 'POSTED' AND NEW.status = 'VOID')
      OR (NEW.kind = 'SUPPLIER_CREDIT' AND OLD.status = 'DRAFT' AND NEW.status = 'POSTED'))
      AND current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'supplier credit posting and document cancellation require read committed isolation' USING ERRCODE = 'AL006';
  END IF;
  RETURN NEW;
END $$;
-- Before supplier_credit_limits, so no dependency reads occur with an old snapshot.
CREATE TRIGGER supplier_credit_00_isolation BEFORE UPDATE ON purchase_document
  FOR EACH ROW EXECUTE FUNCTION supplier_document_isolation();
REVOKE ALL ON FUNCTION supplier_application_guard(), supplier_document_isolation() FROM PUBLIC;
