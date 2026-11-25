BEGIN;
CREATE FUNCTION mileage_text_valid(value TEXT, minimum INTEGER, maximum INTEGER) RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE SET search_path=pg_catalog,public AS $$
 SELECT length(value) BETWEEN minimum AND maximum
  AND value=btrim(value,U&'\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\202F\205F\3000\FEFF')
  AND value !~ '[[:cntrl:]]' AND value !~ U&'[\007F-\009F\2028\2029]'
$$;
CREATE TABLE mileage_trip (
 id UUID PRIMARY KEY, company_id UUID NOT NULL REFERENCES company(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 trip_date DATE NOT NULL, vehicle TEXT NOT NULL, origin TEXT NOT NULL, destination TEXT NOT NULL, purpose TEXT NOT NULL,
 usage TEXT NOT NULL, distance_meters INTEGER NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
 created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ(6) NOT NULL,
 CONSTRAINT mileage_trip_date CHECK(trip_date BETWEEN DATE '1900-01-01' AND DATE '2999-12-31'),
 CONSTRAINT mileage_trip_usage CHECK(usage IN ('BUSINESS','PERSONAL')),
 CONSTRAINT mileage_trip_distance CHECK(distance_meters BETWEEN 1 AND 10000000),
 CONSTRAINT mileage_trip_revision CHECK(revision>0),
 CONSTRAINT mileage_trip_text CHECK(mileage_text_valid(vehicle,1,80) AND mileage_text_valid(origin,1,160) AND mileage_text_valid(destination,1,160) AND mileage_text_valid(purpose,0,200)),
 CONSTRAINT mileage_trip_business_purpose CHECK(usage<>'BUSINESS' OR length(purpose)>0)
);
CREATE INDEX mileage_trip_company_id_trip_date_created_at_id_idx ON mileage_trip(company_id,trip_date,created_at,id);
CREATE FUNCTION mileage_trip_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.trip_date>(statement_timestamp() AT TIME ZONE 'UTC')::date THEN
  RAISE EXCEPTION 'a trip cannot be dated in the future' USING ERRCODE='AL004';
 END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.revision<>1 THEN RAISE EXCEPTION 'trip starts at revision one' USING ERRCODE='AL004'; END IF;
 ELSIF (NEW.id,NEW.company_id,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.company_id,OLD.created_at) OR NEW.revision<>OLD.revision+1 THEN
  RAISE EXCEPTION 'immutable trip scope or stale revision' USING ERRCODE='AL004';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER mileage_trip_guard BEFORE INSERT OR UPDATE ON mileage_trip FOR EACH ROW EXECUTE FUNCTION mileage_trip_guard();
ALTER TABLE mileage_trip ENABLE ROW LEVEL SECURITY;
ALTER TABLE mileage_trip FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON mileage_trip FOR SELECT USING(company_id=(SELECT app_tenant_id()));
CREATE POLICY tenant_insert ON mileage_trip FOR INSERT WITH CHECK(company_id=(SELECT app_tenant_id()) AND (SELECT app_can_write()));
CREATE POLICY tenant_update ON mileage_trip FOR UPDATE USING(company_id=(SELECT app_tenant_id()) AND (SELECT app_can_write())) WITH CHECK(company_id=(SELECT app_tenant_id()));
CREATE POLICY tenant_delete ON mileage_trip FOR DELETE USING(company_id=(SELECT app_tenant_id()) AND (SELECT app_can_write()));
CREATE POLICY module_read ON mileage_trip AS RESTRICTIVE FOR SELECT USING((SELECT app_module_level('accounting'))<>'none');
CREATE POLICY module_insert ON mileage_trip AS RESTRICTIVE FOR INSERT WITH CHECK((SELECT app_module_level('accounting'))='write');
CREATE POLICY module_update ON mileage_trip AS RESTRICTIVE FOR UPDATE USING((SELECT app_module_level('accounting'))='write') WITH CHECK((SELECT app_module_level('accounting'))='write');
CREATE POLICY module_delete ON mileage_trip AS RESTRICTIVE FOR DELETE USING((SELECT app_module_level('accounting'))='write');
CREATE TRIGGER mileage_trip_audit AFTER INSERT OR UPDATE OR DELETE ON mileage_trip FOR EACH ROW EXECUTE FUNCTION audit_row_change();
GRANT SELECT,INSERT,UPDATE,DELETE ON mileage_trip TO allumi_app;
REVOKE ALL ON FUNCTION mileage_text_valid(TEXT,INTEGER,INTEGER),mileage_trip_guard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mileage_text_valid(TEXT,INTEGER,INTEGER) TO allumi_app;
COMMIT;
