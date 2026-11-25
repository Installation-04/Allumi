BEGIN;
CREATE TABLE cash_forecast_preset (
 id UUID PRIMARY KEY,
 company_id UUID NOT NULL REFERENCES company(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 name TEXT NOT NULL, days INTEGER NOT NULL, receipt_delay INTEGER NOT NULL, payment_delay INTEGER NOT NULL,
 created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
 CONSTRAINT cash_forecast_preset_company_id_name_key UNIQUE(company_id,name),
 CONSTRAINT cash_forecast_preset_name CHECK(length(name) BETWEEN 1 AND 80 AND name=btrim(name) AND name !~ '[[:cntrl:]]'),
 CONSTRAINT cash_forecast_preset_days CHECK(days IN (7,30,60,90)),
 CONSTRAINT cash_forecast_preset_delays CHECK(receipt_delay IN (0,7,14,30) AND payment_delay IN (0,7,14,30))
);
CREATE FUNCTION cash_forecast_preset_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE scope UUID;
BEGIN
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'saved forecast assumptions are immutable' USING ERRCODE='AL004'; END IF;
 IF NOT app_can_write() OR app_module_level('accounting')<>'write' OR app_module_level('sales')='none' THEN
  RAISE EXCEPTION 'accounting write and sales read required' USING ERRCODE='42501';
 END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'forecast preset writes require read committed' USING ERRCODE='AL004';
 END IF;
 IF TG_OP='DELETE' THEN scope:=OLD.company_id; ELSE scope:=NEW.company_id; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('cash_forecast_preset:'||scope::text,0));
 -- A volatile trigger obtains a fresh READ COMMITTED snapshot after waiting for the lock.
 IF TG_OP='INSERT' AND (SELECT count(*) FROM cash_forecast_preset WHERE company_id=scope)>=20 THEN
  RAISE EXCEPTION 'at most twenty saved forecast assumptions per company' USING ERRCODE='AL004';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER cash_forecast_preset_guard BEFORE INSERT OR UPDATE OR DELETE ON cash_forecast_preset FOR EACH ROW EXECUTE FUNCTION cash_forecast_preset_guard();
ALTER TABLE cash_forecast_preset ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_forecast_preset FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON cash_forecast_preset FOR SELECT USING(company_id=(SELECT app_tenant_id()));
CREATE POLICY tenant_insert ON cash_forecast_preset FOR INSERT WITH CHECK(company_id=(SELECT app_tenant_id()) AND (SELECT app_can_write()));
CREATE POLICY tenant_delete ON cash_forecast_preset FOR DELETE USING(company_id=(SELECT app_tenant_id()) AND (SELECT app_can_write()));
CREATE POLICY module_read ON cash_forecast_preset AS RESTRICTIVE FOR SELECT USING((SELECT app_module_level('accounting'))<>'none' AND (SELECT app_module_level('sales'))<>'none');
CREATE POLICY module_insert ON cash_forecast_preset AS RESTRICTIVE FOR INSERT WITH CHECK((SELECT app_module_level('accounting'))='write' AND (SELECT app_module_level('sales'))<>'none');
CREATE POLICY module_delete ON cash_forecast_preset AS RESTRICTIVE FOR DELETE USING((SELECT app_module_level('accounting'))='write' AND (SELECT app_module_level('sales'))<>'none');
CREATE TRIGGER cash_forecast_preset_audit AFTER INSERT OR UPDATE OR DELETE ON cash_forecast_preset FOR EACH ROW EXECUTE FUNCTION audit_row_change();
GRANT SELECT,INSERT,DELETE ON cash_forecast_preset TO allumi_app;
REVOKE ALL ON FUNCTION cash_forecast_preset_guard() FROM PUBLIC;
COMMIT;
