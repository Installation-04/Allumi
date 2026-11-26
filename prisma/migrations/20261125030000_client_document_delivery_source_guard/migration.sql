BEGIN;
CREATE OR REPLACE FUNCTION client_document_delivery_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE d public.client_document;
BEGIN
 IF TG_OP='INSERT' THEN
  SELECT * INTO d FROM public.client_document WHERE company_id=NEW.company_id AND id=NEW.document_id AND status='PUBLISHED' AND revoked_at IS NULL AND expires_at>now() AND customer_email=NEW.recipient AND locale=NEW.locale FOR UPDATE;
  IF NOT FOUND OR NEW.status<>'PENDING' OR NEW.completed_at IS NOT NULL OR NEW.created_by_id IS DISTINCT FROM public.app_current_user_id() THEN RAISE EXCEPTION 'invalid document delivery' USING ERRCODE='AL004'; END IF;
  IF d.kind='ESTIMATE' THEN PERFORM id FROM public.sales_estimate WHERE company_id=d.company_id AND id=d.source_estimate_id AND status IN ('SENT','ACCEPTED','CONVERTED') FOR SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION 'document source unavailable' USING ERRCODE='AL004'; END IF;
  ELSIF d.kind='INVOICE' THEN PERFORM id FROM public.sales_document WHERE company_id=d.company_id AND id=d.source_invoice_id AND status='POSTED' FOR SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION 'document source unavailable' USING ERRCODE='AL004'; END IF;
  END IF;
  IF EXISTS(SELECT 1 FROM public.client_document_delivery WHERE company_id=NEW.company_id AND document_id=NEW.document_id AND created_at>now()-interval '60 seconds') OR (SELECT count(*) FROM public.client_document_delivery WHERE company_id=NEW.company_id AND document_id=NEW.document_id AND created_at>now()-interval '24 hours')>=20 THEN RAISE EXCEPTION 'document delivery rate limit' USING ERRCODE='AL004'; END IF;
  NEW.created_at:=statement_timestamp();
 ELSIF OLD.status<>'PENDING' OR NEW.status NOT IN('ACCEPTED','FAILED','UNKNOWN') OR NEW.completed_at IS NULL OR (to_jsonb(NEW)-ARRAY['status','completed_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','completed_at']) THEN RAISE EXCEPTION 'immutable delivery' USING ERRCODE='AL004'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION client_document_delivery_guard() FROM PUBLIC;
COMMIT;
