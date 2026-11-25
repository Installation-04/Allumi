BEGIN;
CREATE OR REPLACE FUNCTION client_document_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE e public.sales_estimate; i public.sales_document; rendered text;
BEGIN
 IF TG_OP='DELETE' THEN IF OLD.status<>'DRAFT' THEN RAISE EXCEPTION 'published documents cannot be deleted' USING ERRCODE='AL004'; END IF; RETURN OLD; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'DRAFT' OR NEW.revision<>1 OR NEW.created_by_id IS DISTINCT FROM public.app_current_user_id() THEN RAISE EXCEPTION 'invalid document creation' USING ERRCODE='AL004'; END IF;
 ELSE
  IF (NEW.id,NEW.company_id,NEW.kind,NEW.source_estimate_id,NEW.source_invoice_id,NEW.created_by_id,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.company_id,OLD.kind,OLD.source_estimate_id,OLD.source_invoice_id,OLD.created_by_id,OLD.created_at) OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'immutable document scope or revision' USING ERRCODE='AL004'; END IF;
  IF OLD.status='PUBLISHED' THEN
   IF (to_jsonb(NEW)-ARRAY['token_hash','token_cipher','expires_at','revoked_at','first_viewed_at','signed_at','signer_name','signer_email','consent_text','revision','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['token_hash','token_cipher','expires_at','revoked_at','first_viewed_at','signed_at','signer_name','signer_email','consent_text','revision','updated_at'])
     OR OLD.first_viewed_at IS NOT NULL AND NEW.first_viewed_at IS DISTINCT FROM OLD.first_viewed_at
     OR OLD.signed_at IS NOT NULL AND (NEW.signed_at,NEW.signer_name,NEW.signer_email,NEW.consent_text) IS DISTINCT FROM (OLD.signed_at,OLD.signer_name,OLD.signer_email,OLD.consent_text)
     OR OLD.revoked_at IS NOT NULL AND (NEW.token_hash,NEW.token_cipher,NEW.expires_at,NEW.revoked_at) IS DISTINCT FROM (OLD.token_hash,OLD.token_cipher,OLD.expires_at,OLD.revoked_at) THEN RAISE EXCEPTION 'published content and evidence are immutable' USING ERRCODE='AL004'; END IF;
  ELSIF NEW.status='PUBLISHED' THEN
   IF NEW.kind='CONTRACT' THEN
    rendered:=public.document_template_render(NEW.body,NEW.hourly_rate_cents,NEW.locale,NEW.customer_name,NEW.issuer_name);
    IF btrim(rendered)='' OR rendered ~ '\{\{|\}\}' THEN RAISE EXCEPTION 'invalid contract variables' USING ERRCODE='AL004'; END IF;
    NEW.rendered_body:=rendered;NEW.source_snapshot:=NULL;
   ELSIF NEW.kind='ESTIMATE' THEN
    SELECT * INTO e FROM public.sales_estimate WHERE company_id=NEW.company_id AND id=NEW.source_estimate_id AND status='SENT' AND valid_until>=(statement_timestamp() AT TIME ZONE 'America/Toronto')::date FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'estimate unavailable' USING ERRCODE='AL004'; END IF;
    NEW.issuer_name:=e.issuer_snapshot->>'name';NEW.customer_name:=e.customer_snapshot->>'name';NEW.title:=CASE WHEN NEW.locale='en' THEN 'Estimate ' ELSE 'Soumission ' END||e.number;NEW.rendered_body:='';
    NEW.source_snapshot:=jsonb_build_object('number',e.number,'reference',e.reference,'date',e.issue_date,'due',e.valid_until,'issuer',public.document_public_address(e.issuer_snapshot),'customer',public.document_public_address(e.customer_snapshot),'terms',e.terms,'subtotal',e.subtotal_cents::text,'total',e.total_cents::text,'taxes',e.tax_summary,'lines',(SELECT coalesce(jsonb_agg(jsonb_build_object('description',l.description,'quantity',l.quantity::text,'unitPrice',l.unit_price::text,'amountCents',l.amount_cents::text) ORDER BY l.position),'[]') FROM public.sales_estimate_line l WHERE l.company_id=NEW.company_id AND l.estimate_id=e.id));
   ELSE
    SELECT * INTO i FROM public.sales_document WHERE company_id=NEW.company_id AND id=NEW.source_invoice_id AND kind='INVOICE' AND status='POSTED' FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'invoice unavailable' USING ERRCODE='AL004'; END IF;
    NEW.issuer_name:=i.issuer_snapshot->>'name';NEW.customer_name:=i.billing_snapshot->>'name';NEW.title:=CASE WHEN NEW.locale='en' THEN 'Invoice ' ELSE 'Facture ' END||i.number;NEW.rendered_body:='';
    NEW.source_snapshot:=jsonb_build_object('number',i.number,'reference',i.reference,'note',i.memo,'date',i.issue_date,'due',i.due_date,'issuer',public.document_public_address(i.issuer_snapshot),'customer',public.document_public_address(i.billing_snapshot),'subtotal',i.subtotal_cents::text,'total',i.total_cents::text,'taxes',(SELECT coalesce(jsonb_agg(jsonb_build_object('code',t.code,'amountCents',d.amount_cents::text)),'[]') FROM public.sales_document_tax d JOIN public.tax t ON t.company_id=d.company_id AND t.id=d.tax_id WHERE d.company_id=NEW.company_id AND d.document_id=i.id),'lines',(SELECT coalesce(jsonb_agg(jsonb_build_object('description',l.description,'quantity',l.quantity::text,'unitPrice',l.unit_price::text,'amountCents',l.amount_cents::text) ORDER BY l.position),'[]') FROM public.sales_document_line l WHERE l.company_id=NEW.company_id AND l.document_id=i.id));
   END IF;
   NEW.published_at:=statement_timestamp();
   NEW.content_hash:=encode(sha256(convert_to(jsonb_build_array(NEW.id,NEW.company_id,NEW.kind,NEW.title,NEW.issuer_name,NEW.customer_name,NEW.customer_email,NEW.locale,NEW.hourly_rate_cents,NEW.rendered_body,NEW.source_snapshot)::text,'UTF8')),'hex');
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION client_document_guard() FROM PUBLIC;
COMMIT;
