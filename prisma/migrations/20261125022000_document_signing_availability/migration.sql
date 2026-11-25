BEGIN;
CREATE OR REPLACE FUNCTION client_document_public(hash text,operation text,signer text DEFAULT NULL,email text DEFAULT NULL,reviewed_hash text DEFAULT NULL,consent boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE d public.client_document; declaration text;
BEGIN
 IF hash IS NULL OR operation IS NULL OR hash !~ '^[0-9a-f]{64}$' OR operation NOT IN('PEEK','OPEN','SIGN') THEN RETURN NULL; END IF;
 SELECT * INTO d FROM public.client_document WHERE token_hash=hash AND status='PUBLISHED' AND revoked_at IS NULL AND expires_at>statement_timestamp() FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF d.kind='INVOICE' AND NOT EXISTS(SELECT 1 FROM public.sales_document WHERE company_id=d.company_id AND id=d.source_invoice_id AND status='POSTED') OR d.kind='ESTIMATE' AND NOT EXISTS(SELECT 1 FROM public.sales_estimate WHERE company_id=d.company_id AND id=d.source_estimate_id AND status IN('SENT','ACCEPTED','CONVERTED')) THEN RETURN NULL; END IF;
 IF operation='PEEK' THEN RETURN jsonb_build_object('title',d.title,'issuer',d.issuer_name,'locale',d.locale); END IF;
 IF operation='SIGN' THEN
  IF d.kind='INVOICE' OR consent IS DISTINCT FROM true OR reviewed_hash IS DISTINCT FROM d.content_hash OR signer IS NULL OR NOT public.mileage_text_valid(signer,1,120) OR email IS DISTINCT FROM d.customer_email OR d.first_viewed_at IS NULL THEN RAISE EXCEPTION 'invalid signature' USING ERRCODE='AL004'; END IF;
  IF d.kind='ESTIMATE' AND d.signed_at IS NULL AND NOT EXISTS(SELECT 1 FROM public.sales_estimate WHERE company_id=d.company_id AND id=d.source_estimate_id AND status='SENT' AND valid_until>=(statement_timestamp() AT TIME ZONE 'America/Toronto')::date) THEN RETURN NULL; END IF;
  IF d.signed_at IS NOT NULL THEN IF (d.signer_name,d.signer_email) IS DISTINCT FROM (signer,email) THEN RAISE EXCEPTION 'signature already recorded' USING ERRCODE='AL004'; END IF;
  ELSE
   declaration:=CASE WHEN d.locale='en' THEN 'I have reviewed this document and agree to sign it electronically. I confirm that I am authorized to sign for the named client.' ELSE 'J’ai consulté ce document et j’accepte de le signer électroniquement. Je confirme être autorisé à signer pour le client indiqué.' END;
   UPDATE public.client_document SET signed_at=statement_timestamp(),signer_name=signer,signer_email=email,consent_text=declaration,revision=revision+1,updated_at=statement_timestamp() WHERE id=d.id RETURNING * INTO d;
  END IF;
 ELSIF d.first_viewed_at IS NULL THEN UPDATE public.client_document SET first_viewed_at=statement_timestamp(),revision=revision+1,updated_at=statement_timestamp() WHERE id=d.id RETURNING * INTO d;
 END IF;
 RETURN jsonb_build_object('id',d.id,'kind',d.kind,'title',d.title,'issuer',d.issuer_name,'customer',d.customer_name,'recipient',d.customer_email,'locale',d.locale,'body',d.rendered_body,'payload',d.source_snapshot,'hash',d.content_hash,'publishedAt',d.published_at,'expiresAt',d.expires_at,'signedAt',d.signed_at,'signerName',d.signer_name,'signerEmail',d.signer_email,'consentText',d.consent_text,'canSign',d.signed_at IS NULL AND (d.kind='CONTRACT' OR d.kind='ESTIMATE' AND EXISTS(SELECT 1 FROM public.sales_estimate WHERE company_id=d.company_id AND id=d.source_estimate_id AND status='SENT' AND valid_until>=(statement_timestamp() AT TIME ZONE 'America/Toronto')::date)));
END $$;
REVOKE ALL ON FUNCTION client_document_public(text,text,text,text,text,boolean) FROM PUBLIC;
COMMIT;
