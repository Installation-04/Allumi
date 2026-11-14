BEGIN;
CREATE FUNCTION sales_recurring_date(start_date date,months integer,idx integer,anchor_day integer) RETURNS date
LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE m date;y integer;BEGIN
 IF start_date IS NULL OR months NOT IN(1,3,12) OR idx NOT BETWEEN 0 AND 13200 OR anchor_day NOT BETWEEN 1 AND 31 THEN RETURN NULL;END IF;
 y:=extract(year FROM start_date)::integer+(extract(month FROM start_date)::integer-1+months*idx)/12;
 IF y>2999 OR y<1900 THEN RETURN NULL;END IF;
 m:=(date_trunc('month',start_date)+make_interval(months=>months*idx))::date;
 RETURN m+least(anchor_day,extract(day FROM(m+interval '1 month - 1 day'))::integer)-1;
END $$;
CREATE TABLE sales_recurring_plan (
 id uuid PRIMARY KEY,company_id uuid NOT NULL REFERENCES company(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 source_invoice_id uuid NOT NULL,creation_key uuid NOT NULL,name text NOT NULL CHECK(char_length(name) BETWEEN 1 AND 100),status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','PAUSED','CANCELLED')),
 start_date date NOT NULL,end_date date,interval_months smallint NOT NULL CHECK(interval_months IN(1,3,12)),anchor_day smallint NOT NULL CHECK(anchor_day BETWEEN 1 AND 31),term_days smallint NOT NULL CHECK(term_days BETWEEN 0 AND 365),
 next_index integer NOT NULL DEFAULT 0 CHECK(next_index BETWEEN 0 AND 13200),created_by_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL,
 CONSTRAINT sales_recurring_plan_company_id_id_key UNIQUE(company_id,id),
 CONSTRAINT sales_recurring_plan_company_id_creation_key_key UNIQUE(company_id,creation_key),
 CONSTRAINT sales_recurring_plan_source_fkey FOREIGN KEY(company_id,source_invoice_id) REFERENCES sales_document(company_id,id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CHECK(start_date BETWEEN '1900-01-01' AND '2998-12-31' AND (end_date IS NULL OR end_date BETWEEN start_date AND '2998-12-31')),
 CHECK(start_date=sales_recurring_date(start_date,interval_months,0,anchor_day))
);
CREATE INDEX sales_recurring_plan_company_id_status_created_at_idx ON sales_recurring_plan(company_id,status,created_at);
CREATE TABLE sales_recurring_occurrence (
 id uuid PRIMARY KEY,company_id uuid NOT NULL,plan_id uuid NOT NULL,occurrence_index integer NOT NULL CHECK(occurrence_index BETWEEN 0 AND 13200),scheduled_date date NOT NULL,
 invoice_id uuid,status text NOT NULL DEFAULT 'GENERATED' CHECK(status IN('GENERATED','DRAFT_DELETED')),
 created_by_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL,
 CONSTRAINT sales_recurring_occurrence_plan_fkey FOREIGN KEY(company_id,plan_id) REFERENCES sales_recurring_plan(company_id,id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT sales_recurring_occurrence_invoice_fkey FOREIGN KEY(company_id,invoice_id) REFERENCES sales_document(company_id,id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT recurring_occurrence_index_key UNIQUE(company_id,plan_id,occurrence_index),
 CONSTRAINT recurring_occurrence_date_key UNIQUE(company_id,plan_id,scheduled_date),
 CONSTRAINT recurring_occurrence_invoice_key UNIQUE(company_id,invoice_id),
 CHECK((status='GENERATED')=(invoice_id IS NOT NULL))
);
DO $$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['sales_recurring_plan','sales_recurring_occurrence'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_read ON %I FOR SELECT USING(company_id=(SELECT app_tenant_id()))',t);
  EXECUTE format('CREATE POLICY tenant_insert ON %I FOR INSERT WITH CHECK(company_id=(SELECT app_tenant_id()) AND (SELECT app_can_write()))',t);
  EXECUTE format('CREATE POLICY tenant_update ON %I FOR UPDATE USING(company_id=(SELECT app_tenant_id()) AND (SELECT app_can_write())) WITH CHECK(company_id=(SELECT app_tenant_id()))',t);
  EXECUTE format('CREATE POLICY module_read ON %I AS RESTRICTIVE FOR SELECT USING((SELECT app_module_level(''sales''))<>''none'')',t);
  EXECUTE format('CREATE POLICY module_insert ON %I AS RESTRICTIVE FOR INSERT WITH CHECK((SELECT app_module_level(''sales''))=''write'')',t);
  EXECUTE format('CREATE POLICY module_update ON %I AS RESTRICTIVE FOR UPDATE USING((SELECT app_module_level(''sales''))=''write'') WITH CHECK((SELECT app_module_level(''sales''))=''write'')',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON %I TO allumi_app',t);
  EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_row_change()',t||'_audit',t);
 END LOOP;
END $$;
CREATE FUNCTION sales_recurring_plan_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'ACTIVE' OR NEW.next_index<>0 OR NEW.created_by_id IS DISTINCT FROM app_current_user_id() OR NOT EXISTS(SELECT 1 FROM sales_document WHERE company_id=NEW.company_id AND id=NEW.source_invoice_id AND kind='INVOICE' AND status='POSTED' AND issue_date<NEW.start_date) THEN RAISE EXCEPTION 'invalid recurring invoice source' USING ERRCODE='AL004';END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['status','next_index','updated_at']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['status','next_index','updated_at']) OR OLD.status='CANCELLED' AND NEW.status<>'CANCELLED' THEN RAISE EXCEPTION 'immutable recurring plan' USING ERRCODE='AL006';END IF;
  IF NEW.next_index<>OLD.next_index THEN
   IF NEW.status<>OLD.status OR OLD.status<>'ACTIVE' OR NEW.next_index<>OLD.next_index+1 OR NOT EXISTS(SELECT 1 FROM sales_recurring_occurrence WHERE company_id=OLD.company_id AND plan_id=OLD.id AND occurrence_index=OLD.next_index AND status='GENERATED') THEN RAISE EXCEPTION 'recurring plan advances with an occurrence' USING ERRCODE='AL004';END IF;
  END IF;
  NEW.updated_at:=greatest(clock_timestamp(),OLD.updated_at+interval '1 microsecond');
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER sales_recurring_plan_guard BEFORE INSERT OR UPDATE ON sales_recurring_plan FOR EACH ROW EXECUTE FUNCTION sales_recurring_plan_guard();
CREATE FUNCTION sales_recurring_occurrence_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE p sales_recurring_plan%ROWTYPE;s sales_document%ROWTYPE;d sales_document%ROWTYPE;expected date;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF OLD.status<>'GENERATED' OR NEW.status<>'DRAFT_DELETED' OR NEW.invoice_id IS NOT NULL OR (to_jsonb(NEW)-ARRAY['status','invoice_id','updated_at']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['status','invoice_id','updated_at']) OR NOT EXISTS(SELECT 1 FROM sales_document WHERE company_id=OLD.company_id AND id=OLD.invoice_id AND status='DRAFT') THEN RAISE EXCEPTION 'immutable recurring occurrence' USING ERRCODE='AL006';END IF;
  NEW.updated_at:=greatest(clock_timestamp(),OLD.updated_at+interval '1 microsecond');RETURN NEW;
 END IF;
 SELECT * INTO p FROM sales_recurring_plan WHERE company_id=NEW.company_id AND id=NEW.plan_id FOR UPDATE;
 expected:=sales_recurring_date(p.start_date,p.interval_months,p.next_index,p.anchor_day);
 IF p.id IS NULL OR p.status<>'ACTIVE' OR NEW.occurrence_index<>p.next_index OR expected IS NULL OR expected IS DISTINCT FROM NEW.scheduled_date OR expected>(now() AT TIME ZONE 'America/Toronto')::date OR p.end_date IS NOT NULL AND expected>p.end_date OR NEW.status<>'GENERATED' OR NEW.created_by_id IS DISTINCT FROM app_current_user_id() THEN RAISE EXCEPTION 'invalid recurring occurrence' USING ERRCODE='AL004';END IF;
 SELECT * INTO s FROM sales_document WHERE company_id=p.company_id AND id=p.source_invoice_id AND kind='INVOICE' AND status='POSTED' FOR SHARE;
 SELECT * INTO d FROM sales_document WHERE company_id=NEW.company_id AND id=NEW.invoice_id AND kind='INVOICE' AND status='DRAFT';
 IF s.id IS NULL OR d.id IS NULL OR d.contact_id<>s.contact_id OR d.tax_rounding<>s.tax_rounding OR d.issue_date<>expected OR d.due_date IS DISTINCT FROM expected+p.term_days OR d.memo IS DISTINCT FROM s.memo OR d.reference IS DISTINCT FROM coalesce(s.reference,s.number) OR EXISTS(
  SELECT 1 FROM (SELECT * FROM sales_document_line WHERE company_id=s.company_id AND document_id=s.id) a FULL JOIN (SELECT * FROM sales_document_line WHERE company_id=d.company_id AND document_id=d.id) b USING(position)
  WHERE (a.description,a.quantity,a.unit_price,a.account_id,a.tax_code_id,a.item_id) IS DISTINCT FROM(b.description,b.quantity,b.unit_price,b.account_id,b.tax_code_id,b.item_id)
 ) THEN RAISE EXCEPTION 'invalid generated recurring invoice' USING ERRCODE='AL004';END IF;RETURN NEW;
END $$;
CREATE TRIGGER sales_recurring_occurrence_guard BEFORE INSERT OR UPDATE ON sales_recurring_occurrence FOR EACH ROW EXECUTE FUNCTION sales_recurring_occurrence_guard();
CREATE FUNCTION sales_recurring_complete() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NOT EXISTS(SELECT 1 FROM sales_recurring_plan WHERE company_id=NEW.company_id AND id=NEW.plan_id AND next_index>NEW.occurrence_index) THEN RAISE EXCEPTION 'recurring occurrence requires advancing the plan' USING ERRCODE='AL004';END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM sales_document WHERE company_id=OLD.company_id AND id=OLD.invoice_id) THEN RAISE EXCEPTION 'unlink requires deleting the draft invoice' USING ERRCODE='AL004';END IF;
 END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER sales_recurring_complete AFTER INSERT OR UPDATE ON sales_recurring_occurrence DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sales_recurring_complete();
CREATE FUNCTION recurring_invoice_contact_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.contact_id<>OLD.contact_id AND EXISTS(SELECT 1 FROM sales_recurring_occurrence o JOIN sales_recurring_plan p ON p.company_id=o.company_id AND p.id=o.plan_id JOIN sales_document s ON s.company_id=p.company_id AND s.id=p.source_invoice_id WHERE o.company_id=NEW.company_id AND o.invoice_id=NEW.id AND s.contact_id<>NEW.contact_id) THEN RAISE EXCEPTION 'recurring invoice keeps its source customer' USING ERRCODE='AL004';END IF;RETURN NEW;
END $$;
CREATE TRIGGER recurring_invoice_contact_guard BEFORE UPDATE OF contact_id ON sales_document FOR EACH ROW EXECUTE FUNCTION recurring_invoice_contact_guard();
REVOKE ALL ON FUNCTION sales_recurring_date(date,integer,integer,integer),sales_recurring_plan_guard(),sales_recurring_occurrence_guard(),sales_recurring_complete(),recurring_invoice_contact_guard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sales_recurring_date(date,integer,integer,integer) TO allumi_app;
COMMIT;
