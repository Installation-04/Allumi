BEGIN;
ALTER TABLE budget_line ADD CONSTRAINT budget_line_company_id_id_key UNIQUE(company_id,id);
CREATE TABLE budget_monthly_target (
 id UUID PRIMARY KEY,company_id UUID NOT NULL REFERENCES company(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 budget_line_id UUID NOT NULL,fiscal_period_id UUID NOT NULL,amount_cents BIGINT NOT NULL,
 created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ(6) NOT NULL,
 CONSTRAINT budget_monthly_target_line_fkey FOREIGN KEY(company_id,budget_line_id) REFERENCES budget_line(company_id,id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT budget_monthly_target_period_fkey FOREIGN KEY(company_id,fiscal_period_id) REFERENCES fiscal_period(company_id,id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT budget_monthly_target_budget_line_id_fiscal_period_id_key UNIQUE(budget_line_id,fiscal_period_id),
 CONSTRAINT budget_monthly_target_amount CHECK(amount_cents BETWEEN 0 AND 100000000000000)
);
CREATE INDEX budget_monthly_target_company_id_budget_line_id_idx ON budget_monthly_target(company_id,budget_line_id);
CREATE INDEX budget_monthly_target_company_id_fiscal_period_id_idx ON budget_monthly_target(company_id,fiscal_period_id);
CREATE FUNCTION budget_monthly_target_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE v_company UUID;v_line UUID;v_budget UUID;v_year UUID;v_annual BIGINT;v_sum NUMERIC;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'monthly planning requires read committed isolation' USING ERRCODE='AL004'; END IF;
 IF NOT app_can_write() OR app_module_level('accounting')<>'write' THEN RAISE EXCEPTION 'accounting write access required' USING ERRCODE='42501'; END IF;
 IF TG_OP='DELETE' THEN v_company:=OLD.company_id;v_line:=OLD.budget_line_id;
 ELSE v_company:=NEW.company_id;v_line:=NEW.budget_line_id; END IF;
 IF TG_OP='UPDATE' AND (NEW.id,NEW.company_id,NEW.budget_line_id,NEW.fiscal_period_id,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.company_id,OLD.budget_line_id,OLD.fiscal_period_id,OLD.created_at) THEN
  RAISE EXCEPTION 'immutable monthly target scope' USING ERRCODE='AL004';
 END IF;
 SELECT budget_id INTO v_budget FROM budget_line WHERE company_id=v_company AND id=v_line;
 IF NOT FOUND THEN RAISE EXCEPTION 'annual target not found' USING ERRCODE='AL004'; END IF;
 PERFORM 1 FROM budget WHERE company_id=v_company AND id=v_budget FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'budget not found' USING ERRCODE='AL004'; END IF;
 -- Re-read after the lock: a waiting transaction must see the committed annual amount and siblings.
 SELECT l.amount_cents,b.fiscal_year_id INTO v_annual,v_year FROM budget_line l JOIN budget b ON b.company_id=l.company_id AND b.id=l.budget_id WHERE l.company_id=v_company AND l.id=v_line;
 IF NOT FOUND THEN RAISE EXCEPTION 'annual target no longer exists' USING ERRCODE='AL004'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF NOT EXISTS(SELECT 1 FROM fiscal_period WHERE company_id=v_company AND id=NEW.fiscal_period_id AND fiscal_year_id=v_year) THEN
  RAISE EXCEPTION 'monthly target must belong to the budget fiscal year' USING ERRCODE='AL004';
 END IF;
 SELECT coalesce(sum(amount_cents),0) INTO v_sum FROM budget_monthly_target WHERE company_id=v_company AND budget_line_id=v_line AND id<>NEW.id;
 IF v_sum+NEW.amount_cents>v_annual THEN RAISE EXCEPTION 'monthly allocations exceed annual target' USING ERRCODE='AL004'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER budget_monthly_target_guard BEFORE INSERT OR UPDATE OR DELETE ON budget_monthly_target FOR EACH ROW EXECUTE FUNCTION budget_monthly_target_guard();
CREATE FUNCTION budget_line_monthly_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE v_sum NUMERIC;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'annual planning requires read committed isolation' USING ERRCODE='AL004'; END IF;
 PERFORM 1 FROM budget WHERE company_id=OLD.company_id AND id=OLD.budget_id FOR UPDATE;
 SELECT coalesce(sum(amount_cents),0) INTO v_sum FROM budget_monthly_target WHERE company_id=OLD.company_id AND budget_line_id=OLD.id;
 IF NEW.amount_cents<v_sum THEN RAISE EXCEPTION 'annual target is below monthly allocation' USING ERRCODE='AL004'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER budget_line_monthly_guard BEFORE UPDATE OF amount_cents ON budget_line FOR EACH ROW EXECUTE FUNCTION budget_line_monthly_guard();
CREATE FUNCTION budget_monthly_target_revision() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE v_company UUID;v_line UUID;
BEGIN
 IF TG_OP='DELETE' THEN v_company:=OLD.company_id;v_line:=OLD.budget_line_id;ELSE v_company:=NEW.company_id;v_line:=NEW.budget_line_id;END IF;
 UPDATE budget SET revision=revision+1,updated_at=clock_timestamp() WHERE company_id=v_company AND id=(SELECT budget_id FROM budget_line WHERE company_id=v_company AND id=v_line);
 RETURN NULL;
END $$;
CREATE TRIGGER budget_monthly_target_revision AFTER INSERT OR UPDATE OR DELETE ON budget_monthly_target FOR EACH ROW EXECUTE FUNCTION budget_monthly_target_revision();
ALTER TABLE budget_monthly_target ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_monthly_target FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON budget_monthly_target FOR SELECT USING(company_id=(SELECT app_tenant_id()));
CREATE POLICY tenant_insert ON budget_monthly_target FOR INSERT WITH CHECK(company_id=(SELECT app_tenant_id()) AND (SELECT app_can_write()));
CREATE POLICY tenant_update ON budget_monthly_target FOR UPDATE USING(company_id=(SELECT app_tenant_id()) AND (SELECT app_can_write())) WITH CHECK(company_id=(SELECT app_tenant_id()));
CREATE POLICY tenant_delete ON budget_monthly_target FOR DELETE USING(company_id=(SELECT app_tenant_id()) AND (SELECT app_can_write()));
CREATE POLICY module_read ON budget_monthly_target AS RESTRICTIVE FOR SELECT USING((SELECT app_module_level('accounting'))<>'none');
CREATE POLICY module_insert ON budget_monthly_target AS RESTRICTIVE FOR INSERT WITH CHECK((SELECT app_module_level('accounting'))='write');
CREATE POLICY module_update ON budget_monthly_target AS RESTRICTIVE FOR UPDATE USING((SELECT app_module_level('accounting'))='write') WITH CHECK((SELECT app_module_level('accounting'))='write');
CREATE POLICY module_delete ON budget_monthly_target AS RESTRICTIVE FOR DELETE USING((SELECT app_module_level('accounting'))='write');
CREATE TRIGGER budget_monthly_target_audit AFTER INSERT OR UPDATE OR DELETE ON budget_monthly_target FOR EACH ROW EXECUTE FUNCTION audit_row_change();
GRANT SELECT,INSERT,UPDATE,DELETE ON budget_monthly_target TO allumi_app;
REVOKE ALL ON FUNCTION budget_monthly_target_guard(),budget_line_monthly_guard(),budget_monthly_target_revision() FROM PUBLIC;
COMMIT;
