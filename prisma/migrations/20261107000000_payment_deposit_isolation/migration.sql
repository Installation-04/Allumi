-- Keep dependency checks current after waiting on the payment row lock.
CREATE OR REPLACE FUNCTION payment_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_mutable text[] := ARRAY['status', 'void_entry_id', 'voided_at', 'voided_by_id', 'void_reason', 'updated_at'];
  je journal_entry%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payments cannot be deleted; void them' USING ERRCODE = 'AL006';
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM assert_account_subtype(NEW.company_id, NEW.account_id,
      ARRAY['CASH', 'BANK', 'CREDIT_CARD', 'CURRENT_ASSET']::account_subtype[], 'payment account');
    SELECT * INTO je FROM journal_entry WHERE company_id = NEW.company_id AND id = NEW.journal_entry_id;
    IF NOT FOUND OR je.source_type <> 'PAYMENT' OR je.source_id IS DISTINCT FROM NEW.id OR je.entry_date <> NEW.payment_date THEN
      RAISE EXCEPTION 'posting entry must come from this payment and share its date' USING ERRCODE = 'AL006';
    END IF;
    IF NEW.status <> 'POSTED' THEN
      RAISE EXCEPTION 'payments are created posted' USING ERRCODE = 'AL006';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'POSTED' OR (to_jsonb(NEW) - v_mutable) IS DISTINCT FROM (to_jsonb(OLD) - v_mutable) THEN
    RAISE EXCEPTION 'payment % is frozen; void it', OLD.number USING ERRCODE = 'AL006';
  END IF;
  IF NEW.status = 'VOID' THEN
    -- Deposits lock this row without changing it. A pre-existing RR snapshot can
    -- otherwise miss a deposit committed before this cancellation acquired its lock.
    IF current_setting('transaction_isolation') <> 'read committed' THEN
      RAISE EXCEPTION 'payment cancellation requires read committed isolation' USING ERRCODE = 'AL006';
    END IF;
    SELECT * INTO je FROM journal_entry WHERE company_id = NEW.company_id AND id = NEW.void_entry_id;
    IF NOT FOUND OR je.reverses_entry_id IS DISTINCT FROM NEW.journal_entry_id THEN
      RAISE EXCEPTION 'void entry must reverse the payment entry' USING ERRCODE = 'AL006';
    END IF;
    IF payment_open_cents(NEW.company_id, NEW.id) <> NEW.amount_cents THEN
      RAISE EXCEPTION 'unapply the allocations and offsets of a payment before voiding it' USING ERRCODE = 'AL006';
    END IF;
    IF EXISTS (SELECT 1 FROM bank_deposit_item i JOIN bank_deposit d ON d.company_id = i.company_id AND d.id = i.deposit_id
                WHERE i.company_id = NEW.company_id AND i.payment_id = NEW.id AND d.status = 'POSTED') THEN
      RAISE EXCEPTION 'void the deposit that contains this payment first' USING ERRCODE = 'AL006';
    END IF;
  END IF;
  RETURN NEW;
END $$;

