-- A receipt can remain on account and later settle several invoices. Serialize
-- and date movements across the whole payment, not only the newest invoice.
CREATE FUNCTION customer_receipt_movement_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  p payment%ROWTYPE;
  received payment%ROWTYPE;
  sent payment%ROWTYPE;
  payment_ids uuid[];
  effective_date date;
  latest_date date;
  effective_period_status period_status;
  is_cancellation boolean := false;
BEGIN
  IF TG_TABLE_NAME = 'payment' THEN
    IF NEW.direction <> 'RECEIVED' OR NEW.ledger <> 'RECEIVABLE' THEN RETURN NEW; END IF;
    IF TG_OP = 'UPDATE' AND NOT (OLD.status = 'POSTED' AND NEW.status = 'VOID') THEN RETURN NEW; END IF;
    IF app_module_level('sales') <> 'write' OR app_module_level('accounting') <> 'write' THEN
      RAISE EXCEPTION 'customer receipts require sales and accounting write access' USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'INSERT' THEN
      IF NEW.payment_date > (now() AT TIME ZONE 'America/Toronto')::date THEN
        RAISE EXCEPTION 'customer receipt dates cannot be in the future' USING ERRCODE = 'AL006';
      END IF;
      RETURN NEW;
    END IF;
    is_cancellation := true;
    payment_ids := ARRAY[NEW.id];
    SELECT entry_date INTO effective_date FROM journal_entry WHERE company_id = NEW.company_id AND id = NEW.void_entry_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'customer receipt reversal is unavailable' USING ERRCODE = 'AL006';
    END IF;
  ELSIF TG_TABLE_NAME = 'payment_allocation' THEN
    SELECT * INTO p FROM payment WHERE company_id = NEW.company_id AND id = NEW.payment_id FOR UPDATE;
    IF NOT FOUND OR p.direction <> 'RECEIVED' OR p.ledger <> 'RECEIVABLE' THEN RETURN NEW; END IF;
    payment_ids := ARRAY[p.id];
  ELSE
    -- The complete pair is locked in UUID order before any availability read.
    -- Payables offsets keep their original guards and permissions.
    PERFORM id FROM payment WHERE company_id = NEW.company_id AND id IN (NEW.received_payment_id, NEW.sent_payment_id) ORDER BY id FOR UPDATE;
    SELECT * INTO received FROM payment WHERE company_id = NEW.company_id AND id = NEW.received_payment_id;
    SELECT * INTO sent FROM payment WHERE company_id = NEW.company_id AND id = NEW.sent_payment_id;
    IF received.ledger IS DISTINCT FROM 'RECEIVABLE' AND sent.ledger IS DISTINCT FROM 'RECEIVABLE' THEN RETURN NEW; END IF;
    payment_ids := ARRAY[NEW.received_payment_id, NEW.sent_payment_id];
  END IF;

  IF current_setting('transaction_isolation') <> 'read committed' THEN
    IF is_cancellation THEN
      RAISE EXCEPTION 'payment cancellation requires read committed isolation' USING ERRCODE = 'AL006';
    END IF;
    RAISE EXCEPTION 'customer receipt movements require read committed isolation' USING ERRCODE = 'AL007';
  END IF;
  IF app_module_level('sales') <> 'write' OR app_module_level('accounting') <> 'write' THEN
    RAISE EXCEPTION 'customer receipt movements require sales and accounting write access' USING ERRCODE = '42501';
  END IF;
  IF NOT is_cancellation THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.unapplied_date IS NOT NULL THEN
        RAISE EXCEPTION 'customer receipt movements must be created active' USING ERRCODE = 'AL007';
      END IF;
      effective_date := NEW.applied_date;
    ELSE
      IF OLD.unapplied_date IS NOT NULL OR NEW.unapplied_date IS NULL THEN
        RAISE EXCEPTION 'customer receipt movements can only be unapplied once' USING ERRCODE = 'AL007';
      END IF;
      effective_date := NEW.unapplied_date;
    END IF;
    IF effective_date < NEW.applied_date THEN
      RAISE EXCEPTION 'customer receipt release precedes its application' USING ERRCODE = 'AL007';
    END IF;
  END IF;
  IF effective_date > (now() AT TIME ZONE 'America/Toronto')::date THEN
    RAISE EXCEPTION 'customer receipt movement dates cannot be in the future' USING ERRCODE = 'AL007';
  END IF;

  SELECT max(d) INTO latest_date FROM (
    SELECT payment_date AS d FROM payment WHERE company_id = NEW.company_id AND id = ANY(payment_ids)
    UNION ALL SELECT applied_date FROM payment_allocation WHERE company_id = NEW.company_id AND payment_id = ANY(payment_ids)
      AND NOT (TG_TABLE_NAME = 'payment_allocation' AND id = NEW.id)
    UNION ALL SELECT unapplied_date FROM payment_allocation WHERE company_id = NEW.company_id AND payment_id = ANY(payment_ids)
      AND NOT (TG_TABLE_NAME = 'payment_allocation' AND id = NEW.id)
    UNION ALL SELECT applied_date FROM payment_offset WHERE company_id = NEW.company_id AND (received_payment_id = ANY(payment_ids) OR sent_payment_id = ANY(payment_ids))
      AND NOT (TG_TABLE_NAME = 'payment_offset' AND id = NEW.id)
    UNION ALL SELECT unapplied_date FROM payment_offset WHERE company_id = NEW.company_id AND (received_payment_id = ANY(payment_ids) OR sent_payment_id = ANY(payment_ids))
      AND NOT (TG_TABLE_NAME = 'payment_offset' AND id = NEW.id)
  ) movements;
  IF effective_date < latest_date THEN
    IF is_cancellation THEN
      RAISE EXCEPTION 'customer receipt cancellation predates a payment movement' USING ERRCODE = 'AL006';
    END IF;
    RAISE EXCEPTION 'customer receipt movement predates a payment movement' USING ERRCODE = 'AL007';
  END IF;
  SELECT status INTO effective_period_status FROM fiscal_period
    WHERE company_id = NEW.company_id AND effective_date BETWEEN start_date AND end_date FOR SHARE;
  IF NOT FOUND OR effective_period_status <> 'OPEN' THEN
    RAISE EXCEPTION 'customer receipt movement requires an open fiscal period' USING ERRCODE = 'AL003';
  END IF;
  RETURN NEW;
END $$;
-- Run before the existing customer_application_guard and general payment guards.
-- The latter continue to enforce immutable history, contacts, statuses, amounts,
-- exact reversals, deposits and composite company foreign keys.
CREATE TRIGGER customer_account_payment_guard BEFORE INSERT OR UPDATE ON payment
  FOR EACH ROW EXECUTE FUNCTION customer_receipt_movement_guard();
CREATE TRIGGER customer_account_allocation_guard BEFORE INSERT OR UPDATE ON payment_allocation
  FOR EACH ROW EXECUTE FUNCTION customer_receipt_movement_guard();
CREATE TRIGGER customer_account_offset_guard BEFORE INSERT OR UPDATE ON payment_offset
  FOR EACH ROW EXECUTE FUNCTION customer_receipt_movement_guard();
REVOKE ALL ON FUNCTION customer_receipt_movement_guard() FROM PUBLIC;
