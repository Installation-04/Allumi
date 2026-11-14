BEGIN;
CREATE TABLE sales_estimate_counter (
 company_id uuid PRIMARY KEY REFERENCES company(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 next_value bigint NOT NULL DEFAULT 1 CHECK(next_value>0), prefix text NOT NULL DEFAULT 'DEV-',padding integer NOT NULL DEFAULT 5 CHECK(padding BETWEEN 0 AND 10),
 CHECK(char_length(prefix)<=20)
);
CREATE TABLE sales_estimate (
 id uuid PRIMARY KEY,company_id uuid NOT NULL REFERENCES company(id) ON DELETE RESTRICT ON UPDATE CASCADE,contact_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','SENT','ACCEPTED','DECLINED','CANCELLED','CONVERTED')),number text,
 issue_date date NOT NULL,valid_until date NOT NULL,reference text,memo text,terms text,locale app_locale NOT NULL DEFAULT 'fr-CA',tax_rounding tax_rounding NOT NULL,
 subtotal_cents bigint NOT NULL CHECK(subtotal_cents>0 AND subtotal_cents<=100000000000000),tax_total_cents bigint NOT NULL CHECK(tax_total_cents>=0),
 total_cents bigint NOT NULL CHECK(total_cents=subtotal_cents+tax_total_cents AND total_cents<=100000000000000),tax_summary jsonb NOT NULL,
 customer_snapshot jsonb,issuer_snapshot jsonb,issued_at timestamptz,responded_at timestamptz,decision_note text,
 converted_invoice_id uuid,converted_at timestamptz,created_by_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL,
 CONSTRAINT sales_estimate_company_id_id_key UNIQUE(company_id,id),
 CONSTRAINT sales_estimate_company_id_number_key UNIQUE(company_id,number),
 CONSTRAINT sales_estimate_company_id_converted_invoice_id_key UNIQUE(company_id,converted_invoice_id),
 CONSTRAINT sales_estimate_contact_fkey FOREIGN KEY(company_id,contact_id) REFERENCES contact(company_id,id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT sales_estimate_invoice_fkey FOREIGN KEY(company_id,converted_invoice_id) REFERENCES sales_document(company_id,id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CHECK(valid_until>=issue_date AND issue_date>='1900-01-01' AND valid_until<='2999-12-31'),
 CHECK(char_length(reference)<=100 AND char_length(memo)<=2000 AND char_length(terms)<=4000 AND char_length(decision_note)<=500),
 CHECK(jsonb_typeof(tax_summary)='array' AND jsonb_array_length(tax_summary)<=10),
 CHECK((number IS NULL AND issued_at IS NULL AND customer_snapshot IS NULL AND issuer_snapshot IS NULL AND status IN('DRAFT','CANCELLED')) OR
  (number IS NOT NULL AND char_length(number) BETWEEN 1 AND 40 AND issued_at IS NOT NULL AND coalesce(jsonb_typeof(customer_snapshot)='object',false) AND coalesce(jsonb_typeof(issuer_snapshot)='object',false) AND status<>'DRAFT')),
 CHECK((status='CONVERTED')=(converted_invoice_id IS NOT NULL) AND (converted_invoice_id IS NULL)=(converted_at IS NULL)),
 CHECK(status NOT IN('ACCEPTED','DECLINED','CONVERTED') OR responded_at IS NOT NULL),
 CHECK(status NOT IN('DRAFT','SENT') OR responded_at IS NULL)
);
CREATE INDEX sales_estimate_company_id_status_issue_date_idx ON sales_estimate(company_id,status,issue_date);
CREATE INDEX sales_estimate_company_id_contact_id_idx ON sales_estimate(company_id,contact_id);
CREATE TABLE sales_estimate_line (
 id uuid PRIMARY KEY,company_id uuid NOT NULL,estimate_id uuid NOT NULL,position smallint NOT NULL CHECK(position BETWEEN 1 AND 50),item_id uuid,description text NOT NULL CHECK(char_length(description) BETWEEN 1 AND 500),
 quantity decimal(19,4) NOT NULL CHECK(quantity>0 AND quantity<1000000000000),unit_price decimal(19,6) NOT NULL CHECK(unit_price>=0 AND unit_price<1000000000000),
 amount_cents bigint NOT NULL CHECK(amount_cents=round(quantity*unit_price*100) AND amount_cents<=100000000000000),account_id uuid NOT NULL,tax_code_id uuid NOT NULL,taxes jsonb NOT NULL,
 CHECK(jsonb_typeof(taxes)='array' AND jsonb_array_length(taxes)<=10),
 CONSTRAINT sales_estimate_line_company_id_estimate_id_position_key UNIQUE(company_id,estimate_id,position),
 CONSTRAINT sales_estimate_line_estimate_fkey FOREIGN KEY(company_id,estimate_id) REFERENCES sales_estimate(company_id,id) ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT sales_estimate_line_item_fkey FOREIGN KEY(company_id,item_id) REFERENCES item(company_id,id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT sales_estimate_line_account_fkey FOREIGN KEY(company_id,account_id) REFERENCES account(company_id,id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT sales_estimate_line_tax_code_fkey FOREIGN KEY(company_id,tax_code_id) REFERENCES tax_code(company_id,id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX sales_estimate_line_company_id_account_id_idx ON sales_estimate_line(company_id,account_id);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['sales_estimate','sales_estimate_line','sales_estimate_counter'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_read ON %I FOR SELECT USING(company_id=(SELECT app_tenant_id()))',t);
  EXECUTE format('CREATE POLICY tenant_insert ON %I FOR INSERT WITH CHECK(company_id=(SELECT app_tenant_id()) AND (SELECT app_can_write()))',t);
  EXECUTE format('CREATE POLICY tenant_update ON %I FOR UPDATE USING(company_id=(SELECT app_tenant_id()) AND (SELECT app_can_write())) WITH CHECK(company_id=(SELECT app_tenant_id()))',t);
  EXECUTE format('CREATE POLICY module_read ON %I AS RESTRICTIVE FOR SELECT USING((SELECT app_module_level(''sales''))<>''none'')',t);
  EXECUTE format('CREATE POLICY module_insert ON %I AS RESTRICTIVE FOR INSERT WITH CHECK((SELECT app_module_level(''sales''))=''write'')',t);
  EXECUTE format('CREATE POLICY module_update ON %I AS RESTRICTIVE FOR UPDATE USING((SELECT app_module_level(''sales''))=''write'') WITH CHECK((SELECT app_module_level(''sales''))=''write'')',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON %I TO allumi_app',t);
  IF t<>'sales_estimate_counter' THEN
   EXECUTE format('CREATE POLICY tenant_delete ON %I FOR DELETE USING(company_id=(SELECT app_tenant_id()) AND (SELECT app_can_write()))',t);
   EXECUTE format('CREATE POLICY module_delete ON %I AS RESTRICTIVE FOR DELETE USING((SELECT app_module_level(''sales''))=''write'')',t);
   EXECUTE format('GRANT DELETE ON %I TO allumi_app',t);
  END IF;
  EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_row_change()',t||'_audit',t);
 END LOOP;
END $$;
CREATE FUNCTION sales_estimate_exact(e sales_estimate) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=public,pg_temp AS $$
DECLARE n integer;s numeric;t numeric;l sales_estimate_line%ROWTYPE;
BEGIN
 SELECT count(*),coalesce(sum(amount_cents),0) INTO n,s FROM sales_estimate_line WHERE company_id=e.company_id AND estimate_id=e.id;
 IF n NOT BETWEEN 1 AND 50 OR s<>e.subtotal_cents THEN RETURN false;END IF;
 FOR l IN SELECT * FROM sales_estimate_line WHERE company_id=e.company_id AND estimate_id=e.id LOOP
  IF NOT EXISTS(SELECT 1 FROM account WHERE company_id=e.company_id AND id=l.account_id AND type='REVENUE' AND is_active)
   OR NOT EXISTS(SELECT 1 FROM tax_code WHERE company_id=e.company_id AND id=l.tax_code_id AND is_active)
   OR (l.item_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM item WHERE company_id=e.company_id AND id=l.item_id AND is_active))
   OR EXISTS(SELECT 1 FROM jsonb_to_recordset(l.taxes) AS x(id uuid,rate numeric) GROUP BY id HAVING count(*)<>1)
   OR EXISTS(SELECT 1 FROM (
     SELECT c.tax_id,tr.rate FROM tax_code_component c JOIN tax tx ON tx.company_id=c.company_id AND tx.id=c.tax_id AND tx.is_active
     JOIN tax_rate tr ON tr.company_id=c.company_id AND tr.tax_id=c.tax_id AND e.issue_date>=tr.effective_from AND (tr.effective_to IS NULL OR e.issue_date<=tr.effective_to)
     WHERE c.company_id=e.company_id AND c.tax_code_id=l.tax_code_id
   ) expected FULL JOIN jsonb_to_recordset(l.taxes) AS actual(id uuid,rate numeric) ON actual.id=expected.tax_id
    WHERE expected.tax_id IS NULL OR actual.id IS NULL OR expected.rate IS DISTINCT FROM actual.rate)
   OR (SELECT count(*) FROM tax_code_component WHERE company_id=e.company_id AND tax_code_id=l.tax_code_id)<>jsonb_array_length(l.taxes)
   THEN RETURN false;END IF;
 END LOOP;
 IF EXISTS(WITH line_tax AS (
   SELECT lt.amount_cents,x.id,x.rate FROM sales_estimate_line lt CROSS JOIN LATERAL jsonb_to_recordset(lt.taxes) AS x(id uuid,rate numeric)
   WHERE lt.company_id=e.company_id AND lt.estimate_id=e.id
  ), expected AS (SELECT id,min(rate) AS rate,sum(amount_cents) AS base_cents,CASE e.tax_rounding WHEN 'PER_LINE' THEN sum(round(amount_cents*rate)) ELSE round(sum(amount_cents)*min(rate)) END AS amount_cents,count(DISTINCT rate) AS rates FROM line_tax GROUP BY id),
  actual AS(SELECT * FROM jsonb_to_recordset(e.tax_summary) AS x(id uuid,code text,rate numeric,"baseCents" numeric,"amountCents" numeric))
  SELECT 1 FROM expected FULL JOIN actual USING(id) WHERE expected.id IS NULL OR actual.id IS NULL OR expected.rates<>1 OR expected.rate NOT BETWEEN 0 AND 0.999999
   OR (expected.rate,expected.base_cents,expected.amount_cents) IS DISTINCT FROM(actual.rate,actual."baseCents",actual."amountCents"))
  OR EXISTS(SELECT 1 FROM jsonb_to_recordset(e.tax_summary) AS x(id uuid) GROUP BY id HAVING count(*)<>1) THEN RETURN false;END IF;
 SELECT coalesce(sum(x."amountCents"),0) INTO t FROM jsonb_to_recordset(e.tax_summary) AS x("amountCents" numeric);
 RETURN t=e.tax_total_cents AND s+t=e.total_cents;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;
END $$;
CREATE FUNCTION sales_estimate_totals_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE e sales_estimate%ROWTYPE;eid uuid;cid uuid;
BEGIN
 IF TG_TABLE_NAME='sales_estimate' THEN
  IF TG_OP='UPDATE' AND OLD.status='CONVERTED' AND NEW.status='ACCEPTED' AND EXISTS(SELECT 1 FROM sales_document WHERE company_id=OLD.company_id AND id=OLD.converted_invoice_id) THEN RAISE EXCEPTION 'unlink requires deleting the draft invoice in the same transaction' USING ERRCODE='AL004';END IF;
  IF TG_OP='UPDATE' AND (to_jsonb(NEW)-ARRAY['status','number','customer_snapshot','issuer_snapshot','issued_at','responded_at','decision_note','converted_invoice_id','converted_at','updated_at'])=(to_jsonb(OLD)-ARRAY['status','number','customer_snapshot','issuer_snapshot','issued_at','responded_at','decision_note','converted_invoice_id','converted_at','updated_at']) THEN RETURN NULL;END IF;
  eid:=NEW.id;cid:=NEW.company_id;
 ELSE eid:=CASE WHEN TG_OP='DELETE' THEN OLD.estimate_id ELSE NEW.estimate_id END;cid:=CASE WHEN TG_OP='DELETE' THEN OLD.company_id ELSE NEW.company_id END;END IF;
 SELECT * INTO e FROM sales_estimate WHERE company_id=cid AND id=eid;
 IF FOUND AND NOT sales_estimate_exact(e) THEN RAISE EXCEPTION 'estimate totals or references are invalid' USING ERRCODE='AL004';END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER sales_estimate_totals AFTER INSERT OR UPDATE ON sales_estimate DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sales_estimate_totals_guard();
CREATE CONSTRAINT TRIGGER sales_estimate_line_totals AFTER INSERT OR UPDATE OR DELETE ON sales_estimate_line DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sales_estimate_totals_guard();
CREATE FUNCTION sales_estimate_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE inv sales_document%ROWTYPE;c sales_estimate_counter%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN IF OLD.status<>'DRAFT' THEN RAISE EXCEPTION 'issued estimates cannot be deleted' USING ERRCODE='AL006';END IF;RETURN OLD;END IF;
 IF NEW.issue_date>(now() AT TIME ZONE 'America/Toronto')::date THEN RAISE EXCEPTION 'estimate date is in the future' USING ERRCODE='AL004';END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'DRAFT' OR NEW.number IS NOT NULL OR NEW.created_by_id IS DISTINCT FROM app_current_user_id() THEN RAISE EXCEPTION 'estimates start as drafts' USING ERRCODE='AL004';END IF;
 ELSE
  IF (NEW.company_id,NEW.id,NEW.created_by_id,NEW.created_at) IS DISTINCT FROM(OLD.company_id,OLD.id,OLD.created_by_id,OLD.created_at) THEN RAISE EXCEPTION 'immutable estimate identity' USING ERRCODE='AL006';END IF;
  IF OLD.status<>'DRAFT' AND (to_jsonb(NEW)-ARRAY['status','responded_at','decision_note','converted_invoice_id','converted_at','updated_at']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['status','responded_at','decision_note','converted_invoice_id','converted_at','updated_at']) THEN RAISE EXCEPTION 'issued estimate is immutable' USING ERRCODE='AL006';END IF;
  IF OLD.status='DRAFT' AND NEW.status<>OLD.status AND (to_jsonb(NEW)-ARRAY['status','number','customer_snapshot','issuer_snapshot','issued_at','updated_at']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['status','number','customer_snapshot','issuer_snapshot','issued_at','updated_at']) THEN RAISE EXCEPTION 'save draft before changing its state' USING ERRCODE='AL006';END IF;
  IF NOT(OLD.status='SENT' AND NEW.status IN('ACCEPTED','DECLINED')) AND (NEW.responded_at,NEW.decision_note) IS DISTINCT FROM(OLD.responded_at,OLD.decision_note) THEN RAISE EXCEPTION 'immutable estimate response' USING ERRCODE='AL006';END IF;
  IF NOT((OLD.status='ACCEPTED' AND NEW.status='CONVERTED') OR (OLD.status='CONVERTED' AND NEW.status='ACCEPTED')) AND (NEW.converted_invoice_id,NEW.converted_at) IS DISTINCT FROM(OLD.converted_invoice_id,OLD.converted_at) THEN RAISE EXCEPTION 'immutable estimate conversion' USING ERRCODE='AL006';END IF;
  IF OLD.status=NEW.status THEN
   IF OLD.status<>'DRAFT' AND (to_jsonb(NEW)-'updated_at') IS DISTINCT FROM(to_jsonb(OLD)-'updated_at') THEN RAISE EXCEPTION 'immutable estimate state' USING ERRCODE='AL006';END IF;
  ELSIF OLD.status='DRAFT' AND NEW.status='SENT' THEN
   IF NOT EXISTS(SELECT 1 FROM contact WHERE company_id=NEW.company_id AND id=NEW.contact_id AND is_active AND is_customer AND anonymized_at IS NULL) OR NEW.valid_until<(now() AT TIME ZONE 'America/Toronto')::date OR NOT sales_estimate_exact(OLD)
    OR NEW.customer_snapshot->>'name' IS DISTINCT FROM(SELECT display_name FROM contact WHERE company_id=NEW.company_id AND id=NEW.contact_id AND is_active AND is_customer AND anonymized_at IS NULL)
    OR NEW.issuer_snapshot->>'name' IS DISTINCT FROM(SELECT name FROM company WHERE id=NEW.company_id) THEN RAISE EXCEPTION 'invalid estimate issue' USING ERRCODE='AL004';END IF;
   SELECT * INTO c FROM sales_estimate_counter WHERE company_id=NEW.company_id;
   IF c.next_value IS NULL OR c.next_value<=1 OR NEW.number IS DISTINCT FROM c.prefix||lpad((c.next_value-1)::text,greatest(c.padding,length((c.next_value-1)::text)),'0') THEN RAISE EXCEPTION 'invalid estimate number' USING ERRCODE='AL004';END IF;
   NEW.issued_at:=clock_timestamp();
  ELSIF OLD.status='SENT' AND NEW.status IN('ACCEPTED','DECLINED') THEN
   IF NEW.status='ACCEPTED' AND NEW.valid_until<(now() AT TIME ZONE 'America/Toronto')::date THEN RAISE EXCEPTION 'expired estimate' USING ERRCODE='AL004';END IF;
   NEW.responded_at:=clock_timestamp();
  ELSIF OLD.status IN('DRAFT','SENT','ACCEPTED') AND NEW.status='CANCELLED' THEN NULL;
  ELSIF OLD.status='ACCEPTED' AND NEW.status='CONVERTED' THEN
   SELECT * INTO inv FROM sales_document WHERE company_id=NEW.company_id AND id=NEW.converted_invoice_id AND kind='INVOICE' AND status='DRAFT';
   IF NOT FOUND OR inv.contact_id<>NEW.contact_id OR inv.issue_date<NEW.issue_date OR inv.tax_rounding<>NEW.tax_rounding OR EXISTS(
    SELECT 1 FROM (SELECT * FROM sales_estimate_line WHERE company_id=NEW.company_id AND estimate_id=NEW.id) q
    FULL JOIN (SELECT * FROM sales_document_line WHERE company_id=NEW.company_id AND document_id=NEW.converted_invoice_id) l USING(position)
    WHERE (q.description,q.quantity,q.unit_price,q.account_id,q.tax_code_id,q.item_id) IS DISTINCT FROM(l.description,l.quantity,l.unit_price,l.account_id,l.tax_code_id,l.item_id)
   ) THEN RAISE EXCEPTION 'invalid converted invoice' USING ERRCODE='AL004';END IF;NEW.converted_at:=clock_timestamp();
  ELSIF OLD.status='CONVERTED' AND NEW.status='ACCEPTED' THEN
   IF NOT EXISTS(SELECT 1 FROM sales_document WHERE company_id=OLD.company_id AND id=OLD.converted_invoice_id AND kind='INVOICE' AND status='DRAFT') OR NEW.converted_invoice_id IS NOT NULL THEN RAISE EXCEPTION 'only a draft conversion can be removed' USING ERRCODE='AL006';END IF;
  ELSE RAISE EXCEPTION 'invalid estimate transition' USING ERRCODE='AL006';END IF;
  NEW.updated_at:=greatest(clock_timestamp(),OLD.updated_at+interval '1 microsecond');
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER sales_estimate_guard BEFORE INSERT OR UPDATE OR DELETE ON sales_estimate FOR EACH ROW EXECUTE FUNCTION sales_estimate_guard();
CREATE FUNCTION sales_estimate_line_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE s text;BEGIN
 SELECT status INTO s FROM sales_estimate WHERE company_id=coalesce(NEW.company_id,OLD.company_id) AND id=coalesce(NEW.estimate_id,OLD.estimate_id) FOR UPDATE;
 IF NOT FOUND AND TG_OP='DELETE' THEN RETURN OLD;END IF;
 IF s IS DISTINCT FROM 'DRAFT' OR (TG_OP='UPDATE' AND (NEW.company_id,NEW.estimate_id,NEW.id) IS DISTINCT FROM(OLD.company_id,OLD.estimate_id,OLD.id)) THEN RAISE EXCEPTION 'issued estimate lines are immutable' USING ERRCODE='AL006';END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER sales_estimate_line_guard BEFORE INSERT OR UPDATE OR DELETE ON sales_estimate_line FOR EACH ROW EXECUTE FUNCTION sales_estimate_line_guard();
CREATE FUNCTION sales_estimate_counter_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='INSERT' THEN IF NEW.next_value<>1 OR NEW.prefix<>'DEV-' OR NEW.padding<>5 THEN RAISE EXCEPTION 'invalid estimate counter' USING ERRCODE='AL009';END IF;
 ELSIF (NEW.company_id,NEW.prefix,NEW.padding) IS DISTINCT FROM(OLD.company_id,OLD.prefix,OLD.padding) OR NEW.next_value<>OLD.next_value+1 THEN RAISE EXCEPTION 'estimate counter advances by one' USING ERRCODE='AL009';END IF;RETURN NEW;
END $$;
CREATE TRIGGER sales_estimate_counter_guard BEFORE INSERT OR UPDATE ON sales_estimate_counter FOR EACH ROW EXECUTE FUNCTION sales_estimate_counter_guard();
CREATE FUNCTION estimate_invoice_contact_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.contact_id<>OLD.contact_id AND EXISTS(SELECT 1 FROM sales_estimate WHERE company_id=NEW.company_id AND converted_invoice_id=NEW.id) THEN RAISE EXCEPTION 'converted invoice keeps its estimate customer' USING ERRCODE='AL004';END IF;RETURN NEW;
END $$;
CREATE TRIGGER estimate_invoice_contact_guard BEFORE UPDATE OF contact_id ON sales_document FOR EACH ROW EXECUTE FUNCTION estimate_invoice_contact_guard();
REVOKE ALL ON FUNCTION sales_estimate_exact(sales_estimate),sales_estimate_totals_guard(),sales_estimate_guard(),sales_estimate_line_guard(),sales_estimate_counter_guard(),estimate_invoice_contact_guard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sales_estimate_exact(sales_estimate) TO allumi_app;
COMMIT;
