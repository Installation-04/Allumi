BEGIN;
-- A read-only bearer capability. All availability checks and publication fields share one snapshot.
CREATE FUNCTION client_document_public_copy(hash text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE d public.client_document;
BEGIN
 IF hash IS NULL OR hash !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
 SELECT * INTO d FROM public.client_document cd
 WHERE cd.token_hash=hash AND cd.status='PUBLISHED' AND cd.signed_at IS NOT NULL
   AND cd.revoked_at IS NULL AND cd.expires_at>statement_timestamp()
   AND (cd.kind='CONTRACT' OR cd.kind='ESTIMATE' AND EXISTS(
     SELECT 1 FROM public.sales_estimate e WHERE e.company_id=cd.company_id AND e.id=cd.source_estimate_id AND e.status IN('SENT','ACCEPTED','CONVERTED')));
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF encode(sha256(convert_to(jsonb_build_array(d.id,d.company_id,d.kind,d.title,d.issuer_name,d.customer_name,d.customer_email,d.locale,d.hourly_rate_cents,d.rendered_body,d.source_snapshot)::text,'UTF8')),'hex') IS DISTINCT FROM d.content_hash THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('id',d.id,'kind',d.kind,'title',d.title,'issuer',d.issuer_name,
   'customer',d.customer_name,'recipient',d.customer_email,'locale',d.locale,'body',d.rendered_body,
   'payload',d.source_snapshot,'hash',d.content_hash,'publishedAt',d.published_at,'expiresAt',d.expires_at,
   'signedAt',d.signed_at,'signerName',d.signer_name,'signerEmail',d.signer_email,'consentText',d.consent_text,
   'firstViewedAt',d.first_viewed_at,'capturedAt',statement_timestamp(),'canSign',false);
END $$;
REVOKE ALL ON FUNCTION client_document_public_copy(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION client_document_public_copy(text) TO allumi_app;
COMMIT;
