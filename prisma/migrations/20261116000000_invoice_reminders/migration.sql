BEGIN;
ALTER TABLE invoice_email ADD COLUMN purpose text NOT NULL DEFAULT 'INVOICE',
 ADD COLUMN reminder_cents bigint, ADD COLUMN reminder_date date;
ALTER TABLE invoice_email ADD CONSTRAINT invoice_email_purpose_check CHECK (
 (purpose='INVOICE' AND reminder_cents IS NULL AND reminder_date IS NULL)
 OR (purpose='REMINDER' AND reminder_cents>0 AND reminder_cents IS NOT NULL AND reminder_date IS NOT NULL));
CREATE OR REPLACE FUNCTION invoice_email_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  -- Serialize requests for one invoice even when bypassing the application service.
  PERFORM id FROM sales_document WHERE company_id=NEW.company_id AND id=NEW.document_id AND kind='INVOICE' AND status='POSTED' FOR UPDATE;
  IF NOT FOUND OR NEW.status<>'PENDING' OR NEW.completed_at IS NOT NULL
    OR NEW.created_by_id IS DISTINCT FROM nullif(current_setting('app.user_id',true),'')::uuid
    THEN
   RAISE EXCEPTION 'invalid invoice email attempt' USING ERRCODE='AL004';
  END IF;
  IF NEW.purpose='REMINDER' THEN
   IF (SELECT app_module_level('accounting'))='none'
     OR NEW.reminder_date IS DISTINCT FROM (statement_timestamp() AT TIME ZONE 'America/Toronto')::date
     OR NEW.reminder_cents IS DISTINCT FROM sales_document_open_cents(NEW.company_id,NEW.document_id)
     OR NOT EXISTS (SELECT 1 FROM sales_document WHERE company_id=NEW.company_id AND id=NEW.document_id
       AND posting_date<=NEW.reminder_date AND due_date<NEW.reminder_date)
     THEN RAISE EXCEPTION 'stale or unauthorized invoice reminder' USING ERRCODE='AL004'; END IF;
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
COMMIT;
