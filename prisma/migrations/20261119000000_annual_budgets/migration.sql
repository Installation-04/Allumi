BEGIN;
CREATE TABLE budget (
 id UUID PRIMARY KEY, company_id UUID NOT NULL REFERENCES company(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 fiscal_year_id UUID NOT NULL, name TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
 created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ(6) NOT NULL,
 CONSTRAINT budget_company_id_id_key UNIQUE(company_id,id),
 CONSTRAINT budget_company_id_fiscal_year_id_name_key UNIQUE(company_id,fiscal_year_id,name),
 CONSTRAINT budget_fiscal_year_fkey FOREIGN KEY(company_id,fiscal_year_id) REFERENCES fiscal_year(company_id,id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT budget_name CHECK(length(btrim(name)) BETWEEN 1 AND 120 AND name=btrim(name) AND name !~ '[[:cntrl:]]'),
 CONSTRAINT budget_revision CHECK(revision>0)
);
CREATE TABLE budget_line (
 id UUID PRIMARY KEY, company_id UUID NOT NULL REFERENCES company(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 budget_id UUID NOT NULL, account_id UUID NOT NULL, amount_cents BIGINT NOT NULL,
 created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ(6) NOT NULL,
 CONSTRAINT budget_line_budget_id_account_id_key UNIQUE(budget_id,account_id),
 CONSTRAINT budget_line_budget_fkey FOREIGN KEY(company_id,budget_id) REFERENCES budget(company_id,id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT budget_line_account_fkey FOREIGN KEY(company_id,account_id) REFERENCES account(company_id,id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT budget_line_amount CHECK(amount_cents BETWEEN 0 AND 100000000000000)
);
CREATE INDEX budget_line_company_id_account_id_idx ON budget_line(company_id,account_id);
CREATE INDEX budget_line_company_id_budget_id_idx ON budget_line(company_id,budget_id);
CREATE FUNCTION budget_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.revision<>1 THEN RAISE EXCEPTION 'budget starts at revision one' USING ERRCODE='AL004'; END IF;
 ELSE
  IF (NEW.id,NEW.company_id,NEW.fiscal_year_id,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.company_id,OLD.fiscal_year_id,OLD.created_at) OR NEW.revision<>OLD.revision+1 THEN
   RAISE EXCEPTION 'immutable budget scope or invalid revision' USING ERRCODE='AL004';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER budget_guard BEFORE INSERT OR UPDATE ON budget FOR EACH ROW EXECUTE FUNCTION budget_guard();
CREATE FUNCTION budget_line_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE a account%ROWTYPE;
BEGIN
 IF NOT app_can_write() OR app_module_level('accounting')<>'write' THEN
  RAISE EXCEPTION 'accounting write access required' USING ERRCODE='42501';
 END IF;
 SELECT * INTO a FROM account WHERE company_id=NEW.company_id AND id=NEW.account_id FOR SHARE;
 IF NOT FOUND OR a.type NOT IN ('REVENUE','EXPENSE') OR (TG_OP='INSERT' AND NOT a.is_active) THEN
  RAISE EXCEPTION 'budget account must be revenue or expense and initially active' USING ERRCODE='AL004';
 END IF;
 IF TG_OP='UPDATE' AND (NEW.id,NEW.company_id,NEW.budget_id,NEW.account_id,NEW.created_at) IS DISTINCT FROM(OLD.id,OLD.company_id,OLD.budget_id,OLD.account_id,OLD.created_at) THEN
  RAISE EXCEPTION 'immutable budget line scope' USING ERRCODE='AL004';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER budget_line_guard BEFORE INSERT OR UPDATE ON budget_line FOR EACH ROW EXECUTE FUNCTION budget_line_guard();
CREATE FUNCTION budget_line_revision() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN UPDATE budget SET revision=revision+1,updated_at=clock_timestamp() WHERE company_id=OLD.company_id AND id=OLD.budget_id;
 ELSE UPDATE budget SET revision=revision+1,updated_at=clock_timestamp() WHERE company_id=NEW.company_id AND id=NEW.budget_id; END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER budget_line_revision AFTER INSERT OR UPDATE OR DELETE ON budget_line FOR EACH ROW EXECUTE FUNCTION budget_line_revision();
DO $$ DECLARE t TEXT; BEGIN
 FOREACH t IN ARRAY ARRAY['budget','budget_line'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_read ON %I FOR SELECT USING(company_id=(SELECT app_tenant_id()))',t);
  EXECUTE format('CREATE POLICY tenant_insert ON %I FOR INSERT WITH CHECK(company_id=(SELECT app_tenant_id()) AND (SELECT app_can_write()))',t);
  EXECUTE format('CREATE POLICY tenant_update ON %I FOR UPDATE USING(company_id=(SELECT app_tenant_id()) AND (SELECT app_can_write())) WITH CHECK(company_id=(SELECT app_tenant_id()))',t);
  EXECUTE format('CREATE POLICY module_read ON %I AS RESTRICTIVE FOR SELECT USING((SELECT app_module_level(''accounting''))<>''none'')',t);
  EXECUTE format('CREATE POLICY module_insert ON %I AS RESTRICTIVE FOR INSERT WITH CHECK((SELECT app_module_level(''accounting''))=''write'')',t);
  EXECUTE format('CREATE POLICY module_update ON %I AS RESTRICTIVE FOR UPDATE USING((SELECT app_module_level(''accounting''))=''write'') WITH CHECK((SELECT app_module_level(''accounting''))=''write'')',t);
  EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_row_change()',t||'_audit',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON %I TO allumi_app',t);
 END LOOP;
END $$;
CREATE POLICY tenant_delete ON budget_line FOR DELETE USING(company_id=(SELECT app_tenant_id()) AND (SELECT app_can_write()));
CREATE POLICY module_delete ON budget_line AS RESTRICTIVE FOR DELETE USING((SELECT app_module_level('accounting'))='write');
GRANT DELETE ON budget_line TO allumi_app;
CREATE FUNCTION budget_account_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.type IS DISTINCT FROM OLD.type AND EXISTS(SELECT 1 FROM budget_line WHERE company_id=OLD.company_id AND account_id=OLD.id) THEN
  RAISE EXCEPTION 'budgeted account type cannot change' USING ERRCODE='AL005';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER budget_account_guard BEFORE UPDATE OF type ON account FOR EACH ROW EXECUTE FUNCTION budget_account_guard();
REVOKE ALL ON FUNCTION budget_account_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION budget_guard(),budget_line_guard(),budget_line_revision() FROM PUBLIC;
COMMIT;
