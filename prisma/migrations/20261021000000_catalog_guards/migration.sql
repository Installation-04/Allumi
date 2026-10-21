-- Catalogue prices are nonnegative, with the same six-place range as the application.
ALTER TABLE item ADD CONSTRAINT item_price_range
  CHECK (unit_price IS NULL OR (unit_price >= 0 AND unit_price < 1000000000000));

CREATE FUNCTION item_account_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.income_account_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM account WHERE company_id = NEW.company_id AND id = NEW.income_account_id AND type = 'REVENUE' AND is_active
  ) THEN RAISE EXCEPTION 'item requires an active revenue account' USING ERRCODE = 'AL004'; END IF;
  IF NEW.expense_account_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM account WHERE company_id = NEW.company_id AND id = NEW.expense_account_id AND type = 'EXPENSE' AND is_active
  ) THEN RAISE EXCEPTION 'item requires an active expense account' USING ERRCODE = 'AL004'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER item_account_guard BEFORE INSERT OR UPDATE OF income_account_id, expense_account_id ON item
  FOR EACH ROW EXECUTE FUNCTION item_account_guard();

CREATE FUNCTION tax_account_types_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM account WHERE company_id = NEW.company_id AND id = NEW.payable_account_id AND type = 'LIABILITY' AND is_active)
     OR (NEW.recoverable_account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM account WHERE company_id = NEW.company_id AND id = NEW.recoverable_account_id AND type = 'ASSET' AND is_active))
  THEN RAISE EXCEPTION 'tax requires active payable and recoverable accounts of the correct types' USING ERRCODE = 'AL004'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tax_account_types_guard BEFORE INSERT OR UPDATE OF payable_account_id, recoverable_account_id ON tax
  FOR EACH ROW EXECUTE FUNCTION tax_account_types_guard();

REVOKE ALL ON FUNCTION item_account_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION tax_account_types_guard() FROM PUBLIC;
