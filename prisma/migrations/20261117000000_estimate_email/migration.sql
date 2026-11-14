BEGIN;
CREATE TABLE estimate_email (
 id uuid PRIMARY KEY,
 company_id uuid NOT NULL REFERENCES company(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 estimate_id uuid NOT NULL,
 recipient text NOT NULL CHECK (length(recipient) BETWEEN 3 AND 254 AND recipient !~ '[[:cntrl:],;<>]'),
 locale text NOT NULL CHECK (locale IN ('fr-CA','en')),
 status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACCEPTED','FAILED','UNKNOWN')),
 created_by_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz,
 FOREIGN KEY (company_id,estimate_id) REFERENCES sales_estimate(company_id,id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CHECK ((status='PENDING') = (completed_at IS NULL))
);
CREATE INDEX estimate_email_company_id_estimate_id_created_at_idx ON estimate_email(company_id,estimate_id,created_at);
ALTER TABLE estimate_email ENABLE ROW LEVEL SECURITY;
ALTER TABLE estimate_email FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON estimate_email FOR SELECT USING (company_id=(SELECT app_tenant_id()) AND (SELECT app_module_level('sales'))<>'none');
CREATE POLICY sales_insert ON estimate_email FOR INSERT WITH CHECK (company_id=(SELECT app_tenant_id()) AND (SELECT app_module_level('sales'))='write');
CREATE POLICY sales_update ON estimate_email FOR UPDATE USING (company_id=(SELECT app_tenant_id()) AND (SELECT app_module_level('sales'))='write') WITH CHECK (company_id=(SELECT app_tenant_id()) AND (SELECT app_module_level('sales'))='write');
CREATE POLICY module_read ON estimate_email AS RESTRICTIVE FOR SELECT USING ((SELECT app_module_level('sales'))<>'none');
GRANT SELECT,INSERT ON estimate_email TO allumi_app;
GRANT UPDATE(status,completed_at) ON estimate_email TO allumi_app;
CREATE FUNCTION estimate_email_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  -- Serialize requests for one estimate even when bypassing the application service.
  PERFORM id FROM sales_estimate WHERE company_id=NEW.company_id AND id=NEW.estimate_id AND status='SENT' AND valid_until >= (statement_timestamp() AT TIME ZONE 'America/Toronto')::date FOR UPDATE;
  IF NOT FOUND OR NEW.status<>'PENDING' OR NEW.completed_at IS NOT NULL
    OR NEW.created_by_id IS DISTINCT FROM nullif(current_setting('app.user_id',true),'')::uuid
    THEN
   RAISE EXCEPTION 'invalid estimate email attempt' USING ERRCODE='AL004';
  END IF;
  NEW.created_at := now();
  IF EXISTS (SELECT 1 FROM estimate_email WHERE company_id=NEW.company_id AND estimate_id=NEW.estimate_id AND (created_at>now()-interval '60 seconds' OR (status='PENDING' AND created_at>now()-interval '5 minutes')))
    OR (SELECT count(*) FROM estimate_email WHERE company_id=NEW.company_id AND estimate_id=NEW.estimate_id AND created_at>now()-interval '24 hours')>=20 THEN
   RAISE EXCEPTION 'estimate email rate limit' USING ERRCODE='AL004';
  END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['status','completed_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','completed_at'])
    OR OLD.status<>'PENDING' OR NEW.status NOT IN ('ACCEPTED','FAILED','UNKNOWN') OR NEW.completed_at IS NULL THEN
   RAISE EXCEPTION 'immutable estimate email attempt' USING ERRCODE='AL004';
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION estimate_email_guard() FROM PUBLIC;
CREATE TRIGGER estimate_email_guard BEFORE INSERT OR UPDATE ON estimate_email FOR EACH ROW EXECUTE FUNCTION estimate_email_guard();
CREATE TRIGGER estimate_email_audit AFTER INSERT OR UPDATE OR DELETE ON estimate_email FOR EACH ROW EXECUTE FUNCTION audit_row_change();
COMMIT;
