BEGIN;
CREATE TABLE bank_rule (
 id uuid PRIMARY KEY,
 company_id uuid NOT NULL REFERENCES company(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120 AND name !~ '[[:cntrl:]]'),
 enabled boolean NOT NULL DEFAULT true,
 priority integer NOT NULL DEFAULT 100 CHECK (priority BETWEEN 0 AND 10000),
 field text NOT NULL CHECK (field IN ('PAYEE','DESCRIPTION')),
 text text NOT NULL CHECK (length(btrim(text)) BETWEEN 1 AND 200 AND text !~ '[[:cntrl:]]'),
 direction text NOT NULL CHECK (direction IN ('ANY','IN','OUT')),
 source_account_id uuid,
 target_account_id uuid NOT NULL,
 min_cents bigint CHECK (min_cents BETWEEN 1 AND 100000000000000),
 max_cents bigint CHECK (max_cents BETWEEN 1 AND 100000000000000),
 revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL,
 FOREIGN KEY (company_id,source_account_id) REFERENCES account(company_id,id) ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY (company_id,target_account_id) REFERENCES account(company_id,id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CHECK (min_cents IS NULL OR max_cents IS NULL OR min_cents<=max_cents),
 CHECK (source_account_id IS DISTINCT FROM target_account_id)
);
CREATE INDEX bank_rule_company_id_enabled_priority_id_idx ON bank_rule(company_id,enabled,priority,id);
ALTER TABLE bank_rule ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_rule FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON bank_rule FOR SELECT USING (company_id=(SELECT app_tenant_id()));
CREATE POLICY accounting_insert ON bank_rule FOR INSERT WITH CHECK (company_id=(SELECT app_tenant_id()) AND (SELECT app_module_level('accounting'))='write');
CREATE POLICY accounting_update ON bank_rule FOR UPDATE USING (company_id=(SELECT app_tenant_id()) AND (SELECT app_module_level('accounting'))='write') WITH CHECK (company_id=(SELECT app_tenant_id()) AND (SELECT app_module_level('accounting'))='write');
CREATE POLICY module_read ON bank_rule AS RESTRICTIVE FOR SELECT USING ((SELECT app_module_level('accounting'))<>'none');
GRANT SELECT,INSERT ON bank_rule TO allumi_app;
GRANT UPDATE(name,enabled,priority,field,text,direction,source_account_id,target_account_id,min_cents,max_cents,updated_at) ON bank_rule TO allumi_app;
CREATE FUNCTION bank_rule_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  NEW.revision:=1;
  NEW.created_at:=now();
  PERFORM id FROM company WHERE id=NEW.company_id FOR UPDATE;
  IF (SELECT count(*) FROM bank_rule WHERE company_id=NEW.company_id)>=200 THEN
   RAISE EXCEPTION 'bank rule limit' USING ERRCODE='AL004';
  END IF;
 ELSE
  NEW.revision:=OLD.revision+1;
 END IF;
 NEW.updated_at:=now();
 -- Lock referenced accounts against concurrent deactivation or recategorization.
 PERFORM id FROM account WHERE company_id=NEW.company_id AND id IN (NEW.source_account_id,NEW.target_account_id) ORDER BY id FOR SHARE;
 IF NEW.enabled AND (NOT EXISTS (SELECT 1 FROM account WHERE company_id=NEW.company_id AND id=NEW.target_account_id AND is_active AND type IN ('REVENUE','EXPENSE'))
 OR (NEW.source_account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM account WHERE company_id=NEW.company_id AND id=NEW.source_account_id AND is_active AND subtype IN ('CASH','BANK','CREDIT_CARD')))) THEN
  RAISE EXCEPTION 'invalid rule accounts' USING ERRCODE='AL004';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION bank_rule_guard() FROM PUBLIC;
CREATE TRIGGER bank_rule_guard BEFORE INSERT OR UPDATE ON bank_rule FOR EACH ROW EXECUTE FUNCTION bank_rule_guard();
CREATE TRIGGER bank_rule_audit AFTER INSERT OR UPDATE OR DELETE ON bank_rule FOR EACH ROW EXECUTE FUNCTION audit_row_change();
COMMIT;
