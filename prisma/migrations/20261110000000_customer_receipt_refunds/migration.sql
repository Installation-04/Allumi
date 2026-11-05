-- Extend the existing customer movement contract to outgoing AR refunds too.
-- A receipt can remain on account and later settle several invoices. Serialize
-- and date movements across the whole payment, not only the newest invoice.
CREATE OR REPLACE FUNCTION customer_receipt_movement_guard() RETURNS trigger
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
    IF NEW.ledger <> 'RECEIVABLE' THEN RETURN NEW; END IF;
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
    IF NOT FOUND OR p.ledger <> 'RECEIVABLE' THEN RETURN NEW; END IF;
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

-- Validate new original customer refunds, including any lines appended after an
-- explicit SET CONSTRAINTS IMMEDIATE. Old originals are not rechecked on void;
-- their reversals remain governed by the exact-mirror ledger rules.
CREATE FUNCTION customer_refund_posting_exact() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  p payment%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME = 'payment' THEN
    IF NEW.direction <> 'SENT' OR NEW.ledger <> 'RECEIVABLE' THEN RETURN NULL; END IF;
    SELECT * INTO p FROM payment WHERE company_id = NEW.company_id AND id = NEW.id;
  ELSE
    SELECT * INTO p FROM payment
      WHERE company_id = NEW.company_id AND journal_entry_id = NEW.entry_id
        AND direction = 'SENT' AND ledger = 'RECEIVABLE';
  END IF;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM account WHERE company_id = p.company_id AND id = p.account_id AND subtype IN ('BANK', 'CASH'))
     OR (SELECT count(*) FROM journal_line WHERE company_id = p.company_id AND entry_id = p.journal_entry_id) <> 2
     OR NOT EXISTS (SELECT 1 FROM journal_line WHERE company_id = p.company_id AND entry_id = p.journal_entry_id
       AND account_id = p.account_id AND debit_cents = 0 AND credit_cents = p.amount_cents
       AND contact_id IS NULL AND tax_id IS NULL AND tax_box IS NULL)
     OR NOT EXISTS (SELECT 1 FROM journal_line l JOIN account a ON a.company_id = l.company_id AND a.id = l.account_id
       WHERE l.company_id = p.company_id AND l.entry_id = p.journal_entry_id
       AND a.system_key = 'ACCOUNTS_RECEIVABLE' AND l.debit_cents = p.amount_cents AND l.credit_cents = 0
       AND l.contact_id = p.contact_id AND l.tax_id IS NULL AND l.tax_box IS NULL) THEN
    RAISE EXCEPTION 'customer refund posting must contain exactly its bank and receivable lines' USING ERRCODE = 'AL006';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER customer_refund_payment_exact AFTER INSERT ON payment
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION customer_refund_posting_exact();
CREATE CONSTRAINT TRIGGER customer_refund_line_exact AFTER INSERT ON journal_line
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION customer_refund_posting_exact();
REVOKE ALL ON FUNCTION customer_refund_posting_exact() FROM PUBLIC;
