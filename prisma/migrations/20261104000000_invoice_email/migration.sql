BEGIN;
CREATE TABLE invoice_email (
 id uuid PRIMARY KEY,
 company_id uuid NOT NULL REFERENCES company(id) ON DELETE RESTRICT,
 document_id uuid NOT NULL,
 recipient text NOT NULL CHECK (length(recipient) BETWEEN 3 AND 254 AND recipient !~ '[[:cntrl:],;<>]'),
 locale text NOT NULL CHECK (locale IN ('fr-CA','en')),
 status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACCEPTED','FAILED','UNKNOWN')),
 created_by_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz,
 FOREIGN KEY (company_id,document_id) REFERENCES sales_document(company_id,id) ON DELETE RESTRICT,
 CHECK ((status='PENDING') = (completed_at IS NULL))
);
CREATE INDEX invoice_email_company_id_document_id_created_at_idx ON invoice_email(company_id,document_id,created_at);
ALTER TABLE invoice_email ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_email FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON invoice_email FOR SELECT USING (company_id=(SELECT app_tenant_id()) AND (SELECT app_module_level('sales'))<>'none');
CREATE POLICY sales_insert ON invoice_email FOR INSERT WITH CHECK (company_id=(SELECT app_tenant_id()) AND (SELECT app_module_level('sales'))='write');
CREATE POLICY sales_update ON invoice_email FOR UPDATE USING (company_id=(SELECT app_tenant_id()) AND (SELECT app_module_level('sales'))='write') WITH CHECK (company_id=(SELECT app_tenant_id()) AND (SELECT app_module_level('sales'))='write');
CREATE POLICY module_read ON invoice_email AS RESTRICTIVE FOR SELECT USING ((SELECT app_module_level('sales'))<>'none');
GRANT SELECT,INSERT ON invoice_email TO allumi_app;
GRANT UPDATE(status,completed_at) ON invoice_email TO allumi_app;
CREATE FUNCTION invoice_email_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  -- Serialize requests for one invoice even when bypassing the application service.
  PERFORM id FROM sales_document WHERE company_id=NEW.company_id AND id=NEW.document_id AND kind='INVOICE' AND status='POSTED' FOR UPDATE;
  IF NOT FOUND OR NEW.status<>'PENDING' OR NEW.completed_at IS NOT NULL
    OR NEW.created_by_id IS DISTINCT FROM nullif(current_setting('app.user_id',true),'')::uuid
    THEN
   RAISE EXCEPTION 'invalid invoice email attempt' USING ERRCODE='AL004';
  END IF;
  NEW.created_at := now();
  IF EXISTS (SELECT 1 FROM invoice_email WHERE company_id=NEW.company_id AND document_id=NEW.document_id AND created_at>now()-interval '60 seconds')
    OR (SELECT count(*) FROM invoice_email WHERE company_id=NEW.company_id AND document_id=NEW.document_id AND created_at>now()-interval '24 hours')>=20 THEN
   RAISE EXCEPTION 'invoice email rate limit' USING ERRCODE='AL004';
  END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['status','completed_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','completed_at'])
    OR OLD.status<>'PENDING' OR NEW.status NOT IN ('ACCEPTED','FAILED','UNKNOWN') OR NEW.completed_at IS NULL THEN
   RAISE EXCEPTION 'immutable invoice email attempt' USING ERRCODE='AL004';
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION invoice_email_guard() FROM PUBLIC;
CREATE TRIGGER invoice_email_guard BEFORE INSERT OR UPDATE ON invoice_email FOR EACH ROW EXECUTE FUNCTION invoice_email_guard();
CREATE TRIGGER invoice_email_audit AFTER INSERT OR UPDATE OR DELETE ON invoice_email FOR EACH ROW EXECUTE FUNCTION audit_row_change();
COMMIT;
