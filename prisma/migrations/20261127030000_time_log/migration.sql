BEGIN;
CREATE TABLE time_entry (
 id UUID PRIMARY KEY, company_id UUID NOT NULL REFERENCES company(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 work_date DATE NOT NULL, project TEXT NOT NULL, person TEXT NOT NULL, task TEXT NOT NULL, notes TEXT NOT NULL,
 usage TEXT NOT NULL, minutes INTEGER NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
 created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ(6) NOT NULL,
 CONSTRAINT time_entry_date CHECK(work_date BETWEEN DATE '1900-01-01' AND DATE '2999-12-31'),
 CONSTRAINT time_entry_usage CHECK(usage IN ('BILLABLE','NON_BILLABLE')),
 CONSTRAINT time_entry_minutes CHECK(minutes BETWEEN 1 AND 1440),
 CONSTRAINT time_entry_revision CHECK(revision>0),
 CONSTRAINT time_entry_text CHECK(mileage_text_valid(project,1,120) AND mileage_text_valid(person,1,80) AND mileage_text_valid(task,1,200) AND mileage_text_valid(notes,0,200))
);
CREATE INDEX time_entry_company_id_work_date_created_at_id_idx ON time_entry(company_id,work_date,created_at,id);
CREATE FUNCTION time_entry_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.work_date>(statement_timestamp() AT TIME ZONE 'America/Toronto')::date THEN
  RAISE EXCEPTION 'a time entry cannot be dated in the future' USING ERRCODE='AL004';
 END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.revision<>1 THEN RAISE EXCEPTION 'entry starts at revision one' USING ERRCODE='AL004'; END IF;
 ELSIF (NEW.id,NEW.company_id,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.company_id,OLD.created_at) OR NEW.revision<>OLD.revision+1 THEN
  RAISE EXCEPTION 'immutable entry scope or stale revision' USING ERRCODE='AL004';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER time_entry_guard BEFORE INSERT OR UPDATE ON time_entry FOR EACH ROW EXECUTE FUNCTION time_entry_guard();
ALTER TABLE time_entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_entry FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON time_entry FOR SELECT USING(company_id=(SELECT app_tenant_id()));
CREATE POLICY tenant_insert ON time_entry FOR INSERT WITH CHECK(company_id=(SELECT app_tenant_id()) AND (SELECT app_can_write()));
CREATE POLICY tenant_update ON time_entry FOR UPDATE USING(company_id=(SELECT app_tenant_id()) AND (SELECT app_can_write())) WITH CHECK(company_id=(SELECT app_tenant_id()));
CREATE POLICY tenant_delete ON time_entry FOR DELETE USING(company_id=(SELECT app_tenant_id()) AND (SELECT app_can_write()));
CREATE POLICY module_read ON time_entry AS RESTRICTIVE FOR SELECT USING((SELECT app_module_level('accounting'))<>'none');
CREATE POLICY module_insert ON time_entry AS RESTRICTIVE FOR INSERT WITH CHECK((SELECT app_module_level('accounting'))='write');
CREATE POLICY module_update ON time_entry AS RESTRICTIVE FOR UPDATE USING((SELECT app_module_level('accounting'))='write') WITH CHECK((SELECT app_module_level('accounting'))='write');
CREATE POLICY module_delete ON time_entry AS RESTRICTIVE FOR DELETE USING((SELECT app_module_level('accounting'))='write');
CREATE TRIGGER time_entry_audit AFTER INSERT OR UPDATE OR DELETE ON time_entry FOR EACH ROW EXECUTE FUNCTION audit_row_change();
GRANT SELECT,INSERT,UPDATE,DELETE ON time_entry TO allumi_app;
REVOKE ALL ON FUNCTION time_entry_guard() FROM PUBLIC;
COMMIT;
