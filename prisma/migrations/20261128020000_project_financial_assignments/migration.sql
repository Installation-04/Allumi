BEGIN;
CREATE TABLE project_entry_assignment (
 id UUID PRIMARY KEY,company_id UUID NOT NULL REFERENCES company(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 entry_id UUID NOT NULL,project_id UUID,revision INTEGER NOT NULL DEFAULT 1,
 created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ(6) NOT NULL,
 CONSTRAINT project_entry_assignment_company_id_entry_id_key UNIQUE(company_id,entry_id),
 CONSTRAINT project_entry_assignment_company_id_entry_id_fkey FOREIGN KEY(company_id,entry_id) REFERENCES journal_entry(company_id,id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT project_entry_assignment_company_id_project_id_fkey FOREIGN KEY(company_id,project_id) REFERENCES project(company_id,id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT project_entry_assignment_revision CHECK(revision>0)
);
CREATE INDEX project_entry_assignment_company_id_project_id_entry_id_idx ON project_entry_assignment(company_id,project_id,entry_id);
CREATE FUNCTION project_entry_assignment_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'detach analytic assignments instead of deleting history' USING ERRCODE='AL004'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.revision<>1 OR NEW.project_id IS NULL THEN RAISE EXCEPTION 'assignment starts linked at revision one' USING ERRCODE='AL004'; END IF;
 ELSE
  IF (NEW.id,NEW.company_id,NEW.entry_id,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.company_id,OLD.entry_id,OLD.created_at) OR NEW.revision<>OLD.revision+1 OR NEW.project_id IS NOT DISTINCT FROM OLD.project_id THEN RAISE EXCEPTION 'immutable assignment scope, stale revision or no change' USING ERRCODE='AL004'; END IF;
 END IF;
 -- Journal entries/lines are immutable; no row lock or write privilege is required.
 PERFORM 1 FROM journal_entry e WHERE e.company_id=NEW.company_id AND e.id=NEW.entry_id AND e.reverses_entry_id IS NULL AND EXISTS(SELECT 1 FROM journal_line l JOIN account a ON a.company_id=l.company_id AND a.id=l.account_id WHERE l.company_id=e.company_id AND l.entry_id=e.id AND a.type IN ('REVENUE','EXPENSE'));
 IF NOT FOUND THEN RAISE EXCEPTION 'classify an original entry with income or expenses' USING ERRCODE='AL004'; END IF;
 IF NEW.project_id IS NOT NULL THEN
  PERFORM 1 FROM project WHERE company_id=NEW.company_id AND id=NEW.project_id AND status='ACTIVE' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'an active project is required' USING ERRCODE='AL004'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER project_entry_assignment_guard BEFORE INSERT OR UPDATE OR DELETE ON project_entry_assignment FOR EACH ROW EXECUTE FUNCTION project_entry_assignment_guard();
ALTER TABLE project_entry_assignment ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_entry_assignment FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON project_entry_assignment FOR SELECT USING(company_id=(SELECT app_tenant_id()));
CREATE POLICY tenant_insert ON project_entry_assignment FOR INSERT WITH CHECK(company_id=(SELECT app_tenant_id()) AND (SELECT app_can_write()));
CREATE POLICY tenant_update ON project_entry_assignment FOR UPDATE USING(company_id=(SELECT app_tenant_id()) AND (SELECT app_can_write())) WITH CHECK(company_id=(SELECT app_tenant_id()));
CREATE POLICY module_read ON project_entry_assignment AS RESTRICTIVE FOR SELECT USING((SELECT app_module_level('accounting'))<>'none');
CREATE POLICY module_insert ON project_entry_assignment AS RESTRICTIVE FOR INSERT WITH CHECK((SELECT app_module_level('accounting'))='write');
CREATE POLICY module_update ON project_entry_assignment AS RESTRICTIVE FOR UPDATE USING((SELECT app_module_level('accounting'))='write') WITH CHECK((SELECT app_module_level('accounting'))='write');
CREATE TRIGGER project_entry_assignment_audit AFTER INSERT OR UPDATE OR DELETE ON project_entry_assignment FOR EACH ROW EXECUTE FUNCTION audit_row_change();
GRANT SELECT,INSERT,UPDATE ON project_entry_assignment TO allumi_app;
REVOKE ALL ON FUNCTION project_entry_assignment_guard() FROM PUBLIC;
COMMIT;
