BEGIN;
CREATE TABLE project (
 id UUID PRIMARY KEY, company_id UUID NOT NULL REFERENCES company(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 code TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', customer_id UUID,
 status TEXT NOT NULL DEFAULT 'ACTIVE', revision INTEGER NOT NULL DEFAULT 1,
 created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ(6) NOT NULL,
 CONSTRAINT project_company_id_id_key UNIQUE(company_id,id),
 CONSTRAINT project_company_id_code_key UNIQUE(company_id,code),
 CONSTRAINT project_customer_fkey FOREIGN KEY(company_id,customer_id) REFERENCES contact(company_id,id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT project_code CHECK(code ~ '^[A-Z0-9][A-Z0-9._-]{0,29}$'),
 CONSTRAINT project_text CHECK(mileage_text_valid(name,1,120) AND mileage_text_valid(description,0,500)),
 CONSTRAINT project_status CHECK(status IN ('ACTIVE','ARCHIVED')),
 CONSTRAINT project_revision CHECK(revision>0)
);
CREATE INDEX project_company_id_status_code_idx ON project(company_id,status,code);
CREATE FUNCTION project_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'archive projects instead of deleting them' USING ERRCODE='AL004'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.revision<>1 OR NEW.status<>'ACTIVE' THEN RAISE EXCEPTION 'project starts active at revision one' USING ERRCODE='AL004'; END IF;
 ELSE
  IF (NEW.id,NEW.company_id,NEW.code,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.company_id,OLD.code,OLD.created_at) OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'immutable project scope/code or stale revision' USING ERRCODE='AL004'; END IF;
  IF (OLD.status='ARCHIVED' OR NEW.status<>OLD.status) AND (NEW.name,NEW.description,NEW.customer_id) IS DISTINCT FROM (OLD.name,OLD.description,OLD.customer_id) THEN RAISE EXCEPTION 'reactivate before editing an archived project' USING ERRCODE='AL004'; END IF;
 END IF;
 IF NEW.customer_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.customer_id IS DISTINCT FROM OLD.customer_id) THEN
  IF app_module_level('contacts')='none' THEN RAISE EXCEPTION 'contact read required to assign a client' USING ERRCODE='AL004'; END IF;
  PERFORM 1 FROM contact WHERE company_id=NEW.company_id AND id=NEW.customer_id AND is_customer AND is_active AND anonymized_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unavailable project client' USING ERRCODE='AL004'; END IF;
 END IF;
 -- Clearing a link is also a change to the client association.
 IF TG_OP='UPDATE' AND NEW.customer_id IS DISTINCT FROM OLD.customer_id AND app_module_level('contacts')='none' THEN RAISE EXCEPTION 'contact read required to change a client' USING ERRCODE='AL004'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER project_guard BEFORE INSERT OR UPDATE OR DELETE ON project FOR EACH ROW EXECUTE FUNCTION project_guard();
ALTER TABLE project ENABLE ROW LEVEL SECURITY;
ALTER TABLE project FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON project FOR SELECT USING(company_id=(SELECT app_tenant_id()));
CREATE POLICY tenant_insert ON project FOR INSERT WITH CHECK(company_id=(SELECT app_tenant_id()) AND (SELECT app_can_write()));
CREATE POLICY tenant_update ON project FOR UPDATE USING(company_id=(SELECT app_tenant_id()) AND (SELECT app_can_write())) WITH CHECK(company_id=(SELECT app_tenant_id()));
CREATE POLICY module_read ON project AS RESTRICTIVE FOR SELECT USING((SELECT app_module_level('accounting'))<>'none');
CREATE POLICY module_insert ON project AS RESTRICTIVE FOR INSERT WITH CHECK((SELECT app_module_level('accounting'))='write');
CREATE POLICY module_update ON project AS RESTRICTIVE FOR UPDATE USING((SELECT app_module_level('accounting'))='write') WITH CHECK((SELECT app_module_level('accounting'))='write');
CREATE TRIGGER project_audit AFTER INSERT OR UPDATE OR DELETE ON project FOR EACH ROW EXECUTE FUNCTION audit_row_change();
GRANT SELECT,INSERT,UPDATE ON project TO allumi_app;
REVOKE ALL ON FUNCTION project_guard() FROM PUBLIC;
ALTER TABLE time_entry ADD COLUMN project_id UUID;
ALTER TABLE time_entry ADD CONSTRAINT time_entry_project_fkey FOREIGN KEY(company_id,project_id) REFERENCES project(company_id,id) ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX time_entry_company_id_project_id_work_date_idx ON time_entry(company_id,project_id,work_date);
CREATE OR REPLACE FUNCTION time_entry_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE p project%ROWTYPE;
BEGIN
 IF NEW.work_date>(statement_timestamp() AT TIME ZONE 'America/Toronto')::date THEN RAISE EXCEPTION 'a time entry cannot be dated in the future' USING ERRCODE='AL004'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.revision<>1 THEN RAISE EXCEPTION 'entry starts at revision one' USING ERRCODE='AL004'; END IF;
 ELSIF (NEW.id,NEW.company_id,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.company_id,OLD.created_at) OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'immutable entry scope or stale revision' USING ERRCODE='AL004'; END IF;
 IF NEW.project_id IS NOT NULL THEN
  IF TG_OP='INSERT' OR NEW.project_id IS DISTINCT FROM OLD.project_id THEN
   SELECT * INTO p FROM project WHERE company_id=NEW.company_id AND id=NEW.project_id FOR SHARE;
   IF NOT FOUND OR p.status<>'ACTIVE' THEN RAISE EXCEPTION 'new time requires an active project' USING ERRCODE='AL004'; END IF;
   NEW.project:=p.name;
  ELSIF NEW.project IS DISTINCT FROM OLD.project THEN RAISE EXCEPTION 'keep the linked time name snapshot' USING ERRCODE='AL004'; END IF;
 END IF;
 RETURN NEW;
END $$;
COMMIT;
