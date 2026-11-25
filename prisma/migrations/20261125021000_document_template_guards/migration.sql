BEGIN;
ALTER TABLE client_document ADD CONSTRAINT client_document_link_window CHECK(expires_at IS NULL OR expires_at<=published_at+interval '90 days');
ALTER TABLE client_document ADD CONSTRAINT client_document_recipient_text CHECK(mileage_text_valid(customer_email,3,254));
CREATE FUNCTION estimate_terms_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE customer text;issuer text;rendered text;
BEGIN
 IF NEW.terms_template IS NOT NULL AND NEW.status='DRAFT' THEN
  SELECT display_name INTO customer FROM public.contact WHERE company_id=NEW.company_id AND id=NEW.contact_id;
  SELECT name INTO issuer FROM public.company WHERE id=NEW.company_id;
  rendered:=public.document_template_render(NEW.terms_template,NEW.hourly_rate_cents,NEW.locale::text,customer,issuer);
  IF rendered IS NULL OR rendered ~ '\{\{|\}\}' OR coalesce(NEW.terms,'') IS DISTINCT FROM rendered THEN RAISE EXCEPTION 'estimate terms differ from their template and hourly rate' USING ERRCODE='AL004'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER estimate_terms_guard BEFORE INSERT OR UPDATE ON sales_estimate FOR EACH ROW EXECUTE FUNCTION estimate_terms_guard();
REVOKE ALL ON FUNCTION estimate_terms_guard() FROM PUBLIC;
-- External capability actions keep anonymous attribution; they never impersonate the document creator.
CREATE FUNCTION client_document_audit_record() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid:=public.app_current_user_id();before_row jsonb;after_row jsonb;before_diff jsonb;after_diff jsonb;verb text:='row.'||lower(TG_OP);external boolean:=false;
BEGIN
 IF TG_OP IN('UPDATE','DELETE') THEN before_row:=to_jsonb(OLD)-ARRAY['token_hash','token_cipher','updated_at']; END IF;
 IF TG_OP IN('INSERT','UPDATE') THEN after_row:=to_jsonb(NEW)-ARRAY['token_hash','token_cipher','updated_at']; END IF;
 IF actor IS NULL AND NOT(SELECT rolsuper FROM pg_roles WHERE rolname=session_user) THEN
  IF TG_OP<>'UPDATE' OR OLD.status<>'PUBLISHED' OR (to_jsonb(NEW)-ARRAY['first_viewed_at','signed_at','signer_name','signer_email','consent_text','revision','updated_at']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['first_viewed_at','signed_at','signer_name','signer_email','consent_text','revision','updated_at']) THEN RAISE EXCEPTION 'invalid external document audit' USING ERRCODE='AL011'; END IF;
  IF OLD.first_viewed_at IS NULL AND NEW.first_viewed_at IS NOT NULL AND NEW.signed_at IS NULL THEN verb:='client.view';
  ELSIF OLD.signed_at IS NULL AND NEW.signed_at IS NOT NULL AND OLD.first_viewed_at IS NOT NULL THEN verb:='client.sign';
  ELSE RAISE EXCEPTION 'external document event required' USING ERRCODE='AL011'; END IF;
  external:=true;
 END IF;
 IF TG_OP='UPDATE' THEN
  SELECT jsonb_object_agg(o.key,o.value) INTO before_diff FROM jsonb_each(before_row)o WHERE after_row->o.key IS DISTINCT FROM o.value;
  SELECT jsonb_object_agg(n.key,n.value) INTO after_diff FROM jsonb_each(after_row)n WHERE before_row->n.key IS DISTINCT FROM n.value;
 ELSE before_diff:=before_row;after_diff:=after_row;END IF;
 IF external THEN after_diff:=coalesce(after_diff,'{}')||jsonb_build_object('_external_actor','LINK_HOLDER');END IF;
 INSERT INTO public.audit_log(company_id,actor_kind,actor_user_id,action,entity_type,entity_id,before,after,request_id)
 VALUES(coalesce(NEW.company_id,OLD.company_id),CASE WHEN actor IS NULL THEN 'SYSTEM'::public.actor_kind ELSE 'USER'::public.actor_kind END,actor,verb,'client_document',coalesce(NEW.id,OLD.id)::text,before_diff,after_diff,nullif(current_setting('app.request_id',true),''));
 RETURN NULL;
END $$;
DROP TRIGGER client_document_audit ON client_document;
CREATE TRIGGER client_document_audit AFTER INSERT OR UPDATE OR DELETE ON client_document FOR EACH ROW EXECUTE FUNCTION client_document_audit_record();
REVOKE ALL ON FUNCTION client_document_audit_record() FROM PUBLIC;
COMMIT;
