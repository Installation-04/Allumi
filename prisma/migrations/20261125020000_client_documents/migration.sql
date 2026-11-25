BEGIN;

CREATE FUNCTION document_hourly_rate(rate bigint, locale text) RETURNS text LANGUAGE SQL IMMUTABLE SET search_path=pg_catalog,public AS $$
 SELECT (rate/100)::text || CASE WHEN locale='en' THEN '.' ELSE ',' END || lpad((rate%100)::text,2,'0') || ' CAD/h'
$$;
CREATE FUNCTION document_template_render(body text, rate bigint, locale text, customer text, issuer text) RETURNS text LANGUAGE SQL IMMUTABLE SET search_path=pg_catalog,public AS $$
 SELECT replace(replace(replace(body,'{{hourly_rate}}',coalesce(document_hourly_rate(rate,locale),'{{hourly_rate}}')),'{{client_name}}',customer),'{{company_name}}',issuer)
$$;
CREATE FUNCTION document_text_valid(value text) RETURNS boolean LANGUAGE SQL IMMUTABLE SET search_path=pg_catalog,public AS $$
 SELECT length(value)<=50000 AND value !~ U&'[\0001-\0008\000B\000C\000E-\001F\007F-\009F]'
$$;

ALTER TABLE sales_estimate ADD COLUMN terms_template text, ADD COLUMN hourly_rate_cents bigint;
DO $$ DECLARE constraint_name text; BEGIN
 SELECT conname INTO STRICT constraint_name FROM pg_constraint WHERE conrelid='sales_estimate'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%char_length(terms)%4000%';
 EXECUTE format('ALTER TABLE sales_estimate DROP CONSTRAINT %I',constraint_name);
END $$;
ALTER TABLE sales_estimate ADD CONSTRAINT sales_estimate_long_terms CHECK(char_length(reference)<=100 AND char_length(memo)<=2000 AND char_length(terms)<=100000 AND char_length(decision_note)<=500 AND (terms_template IS NULL OR document_text_valid(terms_template)) AND (hourly_rate_cents IS NULL OR hourly_rate_cents BETWEEN 1 AND 100000000));

CREATE TABLE contract_template (
 company_id uuid PRIMARY KEY REFERENCES company(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 body text NOT NULL CHECK(document_text_valid(body)), hourly_rate_cents bigint CHECK(hourly_rate_cents BETWEEN 1 AND 100000000),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), updated_at timestamptz(6) NOT NULL
);
CREATE TABLE client_document (
 id uuid PRIMARY KEY,company_id uuid NOT NULL REFERENCES company(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 kind text NOT NULL CHECK(kind IN('CONTRACT','ESTIMATE','INVOICE')),
 source_estimate_id uuid,source_invoice_id uuid,
 title text NOT NULL CHECK(mileage_text_valid(title,1,160)),customer_name text NOT NULL CHECK(mileage_text_valid(customer_name,1,160)),
 customer_email text NOT NULL CHECK(length(customer_email) BETWEEN 3 AND 254 AND customer_email ~ '^[^[:space:]@,;<>]+@[^[:space:]@,;<>]+\.[^[:space:]@,;<>]+$'),
 issuer_name text NOT NULL CHECK(mileage_text_valid(issuer_name,1,200)),locale text NOT NULL CHECK(locale IN('fr-CA','en')),
 body text NOT NULL CHECK(document_text_valid(body)),hourly_rate_cents bigint CHECK(hourly_rate_cents BETWEEN 1 AND 100000000),
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','PUBLISHED')),
 rendered_body text CHECK(length(rendered_body)<=100000),source_snapshot jsonb,content_hash char(64),token_hash char(64),token_cipher bytea,
 published_at timestamptz(6),expires_at timestamptz(6),revoked_at timestamptz(6),first_viewed_at timestamptz(6),
 signed_at timestamptz(6),signer_name text,signer_email text,consent_text text,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),created_by_id uuid NOT NULL,created_at timestamptz(6) NOT NULL DEFAULT now(),updated_at timestamptz(6) NOT NULL,
 CONSTRAINT client_document_company_id_id_key UNIQUE(company_id,id),CONSTRAINT client_document_token_hash_key UNIQUE(token_hash),
 CONSTRAINT client_document_estimate_fkey FOREIGN KEY(company_id,source_estimate_id) REFERENCES sales_estimate(company_id,id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT client_document_invoice_fkey FOREIGN KEY(company_id,source_invoice_id) REFERENCES sales_document(company_id,id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CHECK((kind='CONTRACT' AND source_estimate_id IS NULL AND source_invoice_id IS NULL) OR (kind='ESTIMATE' AND source_estimate_id IS NOT NULL AND source_invoice_id IS NULL) OR (kind='INVOICE' AND source_invoice_id IS NOT NULL AND source_estimate_id IS NULL)),
 CHECK((status='DRAFT' AND rendered_body IS NULL AND source_snapshot IS NULL AND content_hash IS NULL AND token_hash IS NULL AND token_cipher IS NULL AND published_at IS NULL AND expires_at IS NULL AND revoked_at IS NULL AND first_viewed_at IS NULL AND signed_at IS NULL) OR (status='PUBLISHED' AND rendered_body IS NOT NULL AND content_hash IS NOT NULL AND token_hash IS NOT NULL AND token_cipher IS NOT NULL AND expires_at IS NOT NULL AND content_hash ~ '^[0-9a-f]{64}$' AND token_hash ~ '^[0-9a-f]{64}$' AND octet_length(token_cipher)>=30 AND published_at IS NOT NULL AND expires_at>published_at)),
 CHECK((signed_at IS NULL AND signer_name IS NULL AND signer_email IS NULL AND consent_text IS NULL) OR (kind<>'INVOICE' AND signed_at IS NOT NULL AND first_viewed_at IS NOT NULL AND signer_name IS NOT NULL AND signer_email IS NOT NULL AND consent_text IS NOT NULL AND signed_at>=published_at AND first_viewed_at>=published_at AND mileage_text_valid(signer_name,1,120) AND signer_email=customer_email AND length(consent_text)>0))
);
CREATE INDEX client_document_company_id_created_at_id_idx ON client_document(company_id,created_at,id);
CREATE TABLE client_document_delivery (
 id uuid PRIMARY KEY,company_id uuid NOT NULL REFERENCES company(id) ON DELETE RESTRICT ON UPDATE CASCADE,document_id uuid NOT NULL,
 recipient text NOT NULL,locale text NOT NULL CHECK(locale IN('fr-CA','en')),
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','ACCEPTED','FAILED','UNKNOWN')),
 created_by_id uuid NOT NULL,created_at timestamptz(6) NOT NULL DEFAULT now(),completed_at timestamptz(6),
 CONSTRAINT client_document_delivery_document_fkey FOREIGN KEY(company_id,document_id) REFERENCES client_document(company_id,id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CHECK((status='PENDING')=(completed_at IS NULL))
);
CREATE INDEX client_document_delivery_company_id_document_id_created_at_idx ON client_document_delivery(company_id,document_id,created_at);

CREATE FUNCTION document_public_address(value jsonb) RETURNS jsonb LANGUAGE SQL IMMUTABLE SET search_path=pg_catalog,public AS $$
 SELECT jsonb_build_object('name',value->'name','legalName',value->'legalName','addressLine1',value->'addressLine1','addressLine2',value->'addressLine2','city',value->'city','province',value->'province','postalCode',value->'postalCode','country',value->'country','gstNumber',value->'gstNumber','qstNumber',value->'qstNumber')
$$;
CREATE FUNCTION contract_template_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='INSERT' AND NEW.revision<>1 OR TG_OP='UPDATE' AND (NEW.company_id<>OLD.company_id OR NEW.revision<>OLD.revision+1) THEN RAISE EXCEPTION 'invalid template revision' USING ERRCODE='AL004'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER contract_template_guard BEFORE INSERT OR UPDATE ON contract_template FOR EACH ROW EXECUTE FUNCTION contract_template_guard();
CREATE FUNCTION client_document_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
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
    NEW.source_snapshot:=jsonb_build_object('number',e.number,'date',e.issue_date,'due',e.valid_until,'issuer',public.document_public_address(e.issuer_snapshot),'customer',public.document_public_address(e.customer_snapshot),'terms',e.terms,'subtotal',e.subtotal_cents::text,'total',e.total_cents::text,'taxes',e.tax_summary,'lines',(SELECT coalesce(jsonb_agg(jsonb_build_object('description',l.description,'quantity',l.quantity::text,'unitPrice',l.unit_price::text,'amountCents',l.amount_cents::text) ORDER BY l.position),'[]') FROM public.sales_estimate_line l WHERE l.company_id=NEW.company_id AND l.estimate_id=e.id));
   ELSE
    SELECT * INTO i FROM public.sales_document WHERE company_id=NEW.company_id AND id=NEW.source_invoice_id AND kind='INVOICE' AND status='POSTED' FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'invoice unavailable' USING ERRCODE='AL004'; END IF;
    NEW.issuer_name:=i.issuer_snapshot->>'name';NEW.customer_name:=i.billing_snapshot->>'name';NEW.title:=CASE WHEN NEW.locale='en' THEN 'Invoice ' ELSE 'Facture ' END||i.number;NEW.rendered_body:='';
    NEW.source_snapshot:=jsonb_build_object('number',i.number,'date',i.issue_date,'due',i.due_date,'issuer',public.document_public_address(i.issuer_snapshot),'customer',public.document_public_address(i.billing_snapshot),'subtotal',i.subtotal_cents::text,'total',i.total_cents::text,'taxes',(SELECT coalesce(jsonb_agg(jsonb_build_object('code',t.code,'amountCents',d.amount_cents::text)),'[]') FROM public.sales_document_tax d JOIN public.tax t ON t.company_id=d.company_id AND t.id=d.tax_id WHERE d.company_id=NEW.company_id AND d.document_id=i.id),'lines',(SELECT coalesce(jsonb_agg(jsonb_build_object('description',l.description,'quantity',l.quantity::text,'unitPrice',l.unit_price::text,'amountCents',l.amount_cents::text) ORDER BY l.position),'[]') FROM public.sales_document_line l WHERE l.company_id=NEW.company_id AND l.document_id=i.id));
   END IF;
   NEW.published_at:=statement_timestamp();
   NEW.content_hash:=encode(sha256(convert_to(jsonb_build_array(NEW.id,NEW.company_id,NEW.kind,NEW.title,NEW.issuer_name,NEW.customer_name,NEW.customer_email,NEW.locale,NEW.hourly_rate_cents,NEW.rendered_body,NEW.source_snapshot)::text,'UTF8')),'hex');
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER client_document_guard BEFORE INSERT OR UPDATE OR DELETE ON client_document FOR EACH ROW EXECUTE FUNCTION client_document_guard();
CREATE FUNCTION client_document_delivery_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  PERFORM id FROM public.client_document WHERE company_id=NEW.company_id AND id=NEW.document_id AND status='PUBLISHED' AND revoked_at IS NULL AND expires_at>now() AND customer_email=NEW.recipient AND locale=NEW.locale FOR UPDATE;
  IF NOT FOUND OR NEW.status<>'PENDING' OR NEW.completed_at IS NOT NULL OR NEW.created_by_id IS DISTINCT FROM public.app_current_user_id() THEN RAISE EXCEPTION 'invalid document delivery' USING ERRCODE='AL004'; END IF;
  IF EXISTS(SELECT 1 FROM public.client_document_delivery WHERE company_id=NEW.company_id AND document_id=NEW.document_id AND created_at>now()-interval '60 seconds') OR (SELECT count(*) FROM public.client_document_delivery WHERE company_id=NEW.company_id AND document_id=NEW.document_id AND created_at>now()-interval '24 hours')>=20 THEN RAISE EXCEPTION 'document delivery rate limit' USING ERRCODE='AL004'; END IF;
  NEW.created_at:=statement_timestamp();
 ELSIF OLD.status<>'PENDING' OR NEW.status NOT IN('ACCEPTED','FAILED','UNKNOWN') OR NEW.completed_at IS NULL OR (to_jsonb(NEW)-ARRAY['status','completed_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','completed_at']) THEN RAISE EXCEPTION 'immutable delivery' USING ERRCODE='AL004'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER client_document_delivery_guard BEFORE INSERT OR UPDATE ON client_document_delivery FOR EACH ROW EXECUTE FUNCTION client_document_delivery_guard();

DO $$ DECLARE name text; BEGIN FOREACH name IN ARRAY ARRAY['contract_template','client_document','client_document_delivery'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',name);EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',name);
 EXECUTE format('CREATE POLICY tenant_read ON %I FOR SELECT USING(company_id=(SELECT app_tenant_id()))',name);
 EXECUTE format('CREATE POLICY tenant_insert ON %I FOR INSERT WITH CHECK(company_id=(SELECT app_tenant_id()) AND (SELECT app_can_write()))',name);
 EXECUTE format('CREATE POLICY tenant_update ON %I FOR UPDATE USING(company_id=(SELECT app_tenant_id()) AND (SELECT app_can_write())) WITH CHECK(company_id=(SELECT app_tenant_id()))',name);
 EXECUTE format('CREATE POLICY tenant_delete ON %I FOR DELETE USING(company_id=(SELECT app_tenant_id()) AND (SELECT app_can_write()))',name);
 EXECUTE format('CREATE POLICY module_read ON %I AS RESTRICTIVE FOR SELECT USING((SELECT app_module_level(''sales''))<>''none'')',name);
 EXECUTE format('CREATE POLICY module_insert ON %I AS RESTRICTIVE FOR INSERT WITH CHECK((SELECT app_module_level(''sales''))=''write'')',name);
 EXECUTE format('CREATE POLICY module_update ON %I AS RESTRICTIVE FOR UPDATE USING((SELECT app_module_level(''sales''))=''write'') WITH CHECK((SELECT app_module_level(''sales''))=''write'')',name);
 EXECUTE format('CREATE POLICY module_delete ON %I AS RESTRICTIVE FOR DELETE USING((SELECT app_module_level(''sales''))=''write'')',name);
END LOOP; END $$;
GRANT SELECT,INSERT,UPDATE,DELETE ON contract_template TO allumi_app;
GRANT SELECT,INSERT,DELETE ON client_document TO allumi_app;
GRANT UPDATE(title,customer_name,customer_email,issuer_name,locale,body,hourly_rate_cents,status,rendered_body,source_snapshot,content_hash,token_hash,token_cipher,published_at,expires_at,revoked_at,revision,updated_at) ON client_document TO allumi_app;
GRANT SELECT,INSERT ON client_document_delivery TO allumi_app;
GRANT UPDATE(status,completed_at) ON client_document_delivery TO allumi_app;
CREATE TRIGGER contract_template_audit AFTER INSERT OR UPDATE OR DELETE ON contract_template FOR EACH ROW EXECUTE FUNCTION audit_row_change();
CREATE TRIGGER client_document_audit AFTER INSERT OR UPDATE OR DELETE ON client_document FOR EACH ROW EXECUTE FUNCTION audit_row_change('token_hash','token_cipher');
CREATE TRIGGER client_document_delivery_audit AFTER INSERT OR UPDATE OR DELETE ON client_document_delivery FOR EACH ROW EXECUTE FUNCTION audit_row_change();

/** Narrow capability lookup; no anonymous SELECT/UPDATE policies exist on the tables. */
CREATE FUNCTION client_document_public(hash text,operation text,signer text DEFAULT NULL,email text DEFAULT NULL,reviewed_hash text DEFAULT NULL,consent boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE d public.client_document; declaration text;
BEGIN
 IF hash IS NULL OR operation IS NULL OR hash !~ '^[0-9a-f]{64}$' OR operation NOT IN('PEEK','OPEN','SIGN') THEN RETURN NULL; END IF;
 SELECT * INTO d FROM public.client_document WHERE token_hash=hash AND status='PUBLISHED' AND revoked_at IS NULL AND expires_at>statement_timestamp() FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF d.kind='INVOICE' AND NOT EXISTS(SELECT 1 FROM public.sales_document WHERE company_id=d.company_id AND id=d.source_invoice_id AND status='POSTED') OR d.kind='ESTIMATE' AND NOT EXISTS(SELECT 1 FROM public.sales_estimate WHERE company_id=d.company_id AND id=d.source_estimate_id AND status IN('SENT','ACCEPTED','CONVERTED')) THEN RETURN NULL; END IF;
 IF operation='PEEK' THEN RETURN jsonb_build_object('title',d.title,'issuer',d.issuer_name,'locale',d.locale); END IF;
 IF operation='SIGN' THEN
  IF d.kind='INVOICE' OR consent IS DISTINCT FROM true OR reviewed_hash IS DISTINCT FROM d.content_hash OR signer IS NULL OR NOT public.mileage_text_valid(signer,1,120) OR email IS DISTINCT FROM d.customer_email OR d.first_viewed_at IS NULL THEN RAISE EXCEPTION 'invalid signature' USING ERRCODE='AL004'; END IF;
  IF d.kind='ESTIMATE' AND NOT EXISTS(SELECT 1 FROM public.sales_estimate WHERE company_id=d.company_id AND id=d.source_estimate_id AND status='SENT' AND valid_until>=(statement_timestamp() AT TIME ZONE 'America/Toronto')::date) THEN RETURN NULL; END IF;
  IF d.signed_at IS NOT NULL THEN IF (d.signer_name,d.signer_email) IS DISTINCT FROM (signer,email) THEN RAISE EXCEPTION 'signature already recorded' USING ERRCODE='AL004'; END IF;
  ELSE
   declaration:=CASE WHEN d.locale='en' THEN 'I have reviewed this document and agree to sign it electronically. I confirm that I am authorized to sign for the named client.' ELSE 'J’ai consulté ce document et j’accepte de le signer électroniquement. Je confirme être autorisé à signer pour le client indiqué.' END;
   UPDATE public.client_document SET signed_at=statement_timestamp(),signer_name=signer,signer_email=email,consent_text=declaration,revision=revision+1,updated_at=statement_timestamp() WHERE id=d.id RETURNING * INTO d;
  END IF;
 ELSIF d.first_viewed_at IS NULL THEN UPDATE public.client_document SET first_viewed_at=statement_timestamp(),revision=revision+1,updated_at=statement_timestamp() WHERE id=d.id RETURNING * INTO d;
 END IF;
 RETURN jsonb_build_object('id',d.id,'kind',d.kind,'title',d.title,'issuer',d.issuer_name,'customer',d.customer_name,'recipient',d.customer_email,'locale',d.locale,'body',d.rendered_body,'payload',d.source_snapshot,'hash',d.content_hash,'publishedAt',d.published_at,'expiresAt',d.expires_at,'signedAt',d.signed_at,'signerName',d.signer_name,'signerEmail',d.signer_email,'consentText',d.consent_text);
END $$;
REVOKE ALL ON FUNCTION document_public_address(jsonb),document_hourly_rate(bigint,text),document_template_render(text,bigint,text,text,text),document_text_valid(text),contract_template_guard(),client_document_guard(),client_document_delivery_guard(),client_document_public(text,text,text,text,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION document_public_address(jsonb),document_hourly_rate(bigint,text),document_template_render(text,bigint,text,text,text),document_text_valid(text),client_document_public(text,text,text,text,text,boolean) TO allumi_app;
COMMIT;
