BEGIN;
ALTER TABLE bank_deposit ADD COLUMN reference text, ADD COLUMN void_reason text;
ALTER TABLE bank_deposit ADD CONSTRAINT deposit_reference CHECK (reference IS NULL OR length(reference)<=100),
 ADD CONSTRAINT deposit_reason CHECK (void_reason IS NULL OR length(btrim(void_reason)) BETWEEN 1 AND 500),
 ADD CONSTRAINT deposit_amount_limit CHECK (total_cents<=100000000000000);
REVOKE UPDATE ON bank_deposit FROM allumi_app;
GRANT UPDATE(status,void_entry_id,voided_at,voided_by_id,void_reason,updated_at) ON bank_deposit TO allumi_app;
CREATE OR REPLACE FUNCTION bank_deposit_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE je journal_entry; v_mutable text[]:=ARRAY['status','void_entry_id','voided_at','voided_by_id','void_reason','updated_at'];
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'deposits cannot be deleted' USING ERRCODE='AL010'; END IF;
 -- The payment-lock/visibility contract below requires a fresh snapshot after waiting for a lock.
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'deposit writes require read committed isolation' USING ERRCODE='AL010';
 END IF;
 IF TG_OP='INSERT' THEN
  PERFORM assert_account_subtype(NEW.company_id,NEW.account_id,ARRAY['CASH','BANK']::account_subtype[],'deposit account');
  SELECT * INTO je FROM journal_entry WHERE company_id=NEW.company_id AND id=NEW.journal_entry_id;
  IF NOT FOUND OR je.source_type<>'DEPOSIT' OR je.source_id IS DISTINCT FROM NEW.id OR je.entry_date<>NEW.deposit_date
   OR NEW.status<>'POSTED' OR NEW.deposit_date>(now() AT TIME ZONE 'America/Toronto')::date
   OR NEW.void_reason IS NOT NULL OR NEW.voided_by_id IS NOT NULL THEN
   RAISE EXCEPTION 'invalid deposit posting' USING ERRCODE='AL010';
  END IF;
 ELSE
  IF OLD.status<>'POSTED' OR NEW.status<>'VOID'
   OR (to_jsonb(NEW)-v_mutable) IS DISTINCT FROM (to_jsonb(OLD)-v_mutable)
   OR NEW.void_reason IS NULL OR NEW.voided_by_id IS NULL THEN
   RAISE EXCEPTION 'deposits are immutable; void with a reason' USING ERRCODE='AL010';
  END IF;
  SELECT * INTO je FROM journal_entry WHERE company_id=NEW.company_id AND id=NEW.void_entry_id;
  IF NOT FOUND OR je.reverses_entry_id IS DISTINCT FROM NEW.journal_entry_id
   OR je.entry_date<NEW.deposit_date OR je.entry_date>(now() AT TIME ZONE 'America/Toronto')::date THEN
   RAISE EXCEPTION 'invalid deposit reversal' USING ERRCODE='AL010';
  END IF;
  PERFORM id FROM payment WHERE company_id=NEW.company_id AND id IN (SELECT payment_id FROM bank_deposit_item WHERE company_id=NEW.company_id AND deposit_id=NEW.id) ORDER BY id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM journal_line l WHERE l.company_id=NEW.company_id AND l.entry_id=NEW.journal_entry_id AND
   (EXISTS (SELECT 1 FROM bank_match m WHERE m.company_id=l.company_id AND m.journal_line_id=l.id)
    OR EXISTS (SELECT 1 FROM reconciled_line r WHERE r.company_id=l.company_id AND r.journal_line_id=l.id))) THEN
   RAISE EXCEPTION 'unmatch and uncheck a deposit before voiding it' USING ERRCODE='AL010';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION bank_deposit_item_lock() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE d bank_deposit; e journal_entry;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'deposit writes require read committed isolation' USING ERRCODE='AL010'; END IF;
 SELECT * INTO d FROM bank_deposit WHERE company_id=NEW.company_id AND id=NEW.deposit_id FOR UPDATE;
 SELECT * INTO e FROM journal_entry WHERE company_id=d.company_id AND id=d.journal_entry_id;
 IF d.id IS NULL OR d.status<>'POSTED' OR e.created_txid IS DISTINCT FROM pg_current_xact_id()::text::bigint THEN
  RAISE EXCEPTION 'deposit items belong to their creation transaction' USING ERRCODE='AL010';
 END IF;
 PERFORM id FROM payment WHERE company_id=NEW.company_id AND id=NEW.payment_id FOR UPDATE;
 RETURN NEW;
END $$;
CREATE FUNCTION deposit_posting_exact() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE d bank_deposit; source_id uuid; n int; total numeric; v_id uuid;
BEGIN
 IF TG_TABLE_NAME='bank_deposit' THEN v_id:=NEW.id; ELSE v_id:=NEW.deposit_id; END IF;
 SELECT * INTO d FROM bank_deposit WHERE company_id=NEW.company_id AND id=v_id;
 SELECT id INTO source_id FROM account WHERE company_id=d.company_id AND system_key='UNDEPOSITED_FUNDS';
 SELECT count(*),coalesce(sum(p.amount_cents),0) INTO n,total FROM bank_deposit_item i JOIN payment p ON p.company_id=i.company_id AND p.id=i.payment_id WHERE i.company_id=d.company_id AND i.deposit_id=d.id;
 IF source_id IS NULL OR n NOT BETWEEN 1 AND 100 OR total<>d.total_cents
  OR (SELECT count(*) FROM journal_line WHERE company_id=d.company_id AND entry_id=d.journal_entry_id)<>2
  OR NOT EXISTS (SELECT 1 FROM journal_line WHERE company_id=d.company_id AND entry_id=d.journal_entry_id AND account_id=d.account_id AND debit_cents=d.total_cents AND credit_cents=0 AND contact_id IS NULL AND tax_id IS NULL AND tax_box IS NULL)
  OR NOT EXISTS (SELECT 1 FROM journal_line WHERE company_id=d.company_id AND entry_id=d.journal_entry_id AND account_id=source_id AND credit_cents=d.total_cents AND debit_cents=0 AND contact_id IS NULL AND tax_id IS NULL AND tax_box IS NULL) THEN
  RAISE EXCEPTION 'deposit posting must contain exactly its selected receipts' USING ERRCODE='AL010';
 END IF;
 IF d.status='POSTED' AND EXISTS (SELECT 1 FROM bank_deposit_item i JOIN payment p ON p.company_id=i.company_id AND p.id=i.payment_id WHERE i.company_id=d.company_id AND i.deposit_id=d.id AND
  (p.status<>'POSTED' OR p.direction<>'RECEIVED' OR p.ledger<>'RECEIVABLE' OR p.account_id<>source_id OR p.payment_date>d.deposit_date
   OR EXISTS (SELECT 1 FROM bank_deposit_item prior_item JOIN bank_deposit previous ON previous.company_id=prior_item.company_id AND previous.id=prior_item.deposit_id LEFT JOIN journal_entry reversal ON reversal.company_id=previous.company_id AND reversal.id=previous.void_entry_id WHERE prior_item.company_id=d.company_id AND prior_item.payment_id=p.id AND previous.id<>d.id AND (previous.status='POSTED' OR reversal.entry_date>d.deposit_date)))) THEN
  RAISE EXCEPTION 'receipt is unavailable or deposit predates its release' USING ERRCODE='AL010';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER deposit_posting_exact AFTER INSERT OR UPDATE ON bank_deposit DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION deposit_posting_exact();
CREATE CONSTRAINT TRIGGER deposit_items_exact AFTER INSERT ON bank_deposit_item DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION deposit_posting_exact();
-- A match/pointing and a void share a lock on the deposit header, closing the check-then-write race.
CREATE FUNCTION deposit_bank_link_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE d bank_deposit;
BEGIN
 SELECT dep.* INTO d FROM bank_deposit dep JOIN journal_line l ON l.company_id=dep.company_id AND l.entry_id=dep.journal_entry_id WHERE l.company_id=NEW.company_id AND l.id=NEW.journal_line_id FOR SHARE OF dep;
 IF FOUND AND d.status<>'POSTED' THEN RAISE EXCEPTION 'cannot link a void deposit' USING ERRCODE='AL010'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER deposit_bank_link BEFORE INSERT ON bank_match FOR EACH ROW EXECUTE FUNCTION deposit_bank_link_guard();
CREATE TRIGGER deposit_reconciled_link BEFORE INSERT ON reconciled_line FOR EACH ROW EXECUTE FUNCTION deposit_bank_link_guard();
REVOKE ALL ON FUNCTION deposit_posting_exact(),deposit_bank_link_guard() FROM PUBLIC;
COMMIT;
