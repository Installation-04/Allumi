BEGIN;
CREATE TABLE migration_batch (
 id UUID PRIMARY KEY,
 company_id UUID NOT NULL REFERENCES company(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 created_by_id UUID NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 source TEXT NOT NULL CHECK(source IN ('ONLINE','DESKTOP')),
 kind TEXT NOT NULL CHECK(kind IN ('CUSTOMERS','SUPPLIERS','ITEMS','ACCOUNTS','BALANCES')),
 fingerprint CHAR(64) NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
 source_digest CHAR(64) NOT NULL CHECK(source_digest ~ '^[a-f0-9]{64}$'),
 journal_entry_id UUID,
 CONSTRAINT migration_batch_entry_fkey FOREIGN KEY(company_id,journal_entry_id) REFERENCES journal_entry(company_id,id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT migration_batch_entry_kind CHECK((kind='BALANCES')=(journal_entry_id IS NOT NULL)),
 row_count INTEGER NOT NULL CHECK(row_count BETWEEN 1 AND 1000),
 created_count INTEGER NOT NULL CHECK(created_count BETWEEN 1 AND 1000),
 skipped_count INTEGER NOT NULL CHECK(skipped_count BETWEEN 0 AND 999),
 created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
 CONSTRAINT migration_batch_counts CHECK(created_count+skipped_count=row_count),
 CONSTRAINT migration_batch_company_id_kind_fingerprint_key UNIQUE(company_id,kind,fingerprint)
);
CREATE INDEX migration_batch_company_id_created_at_idx ON migration_batch(company_id,created_at);
CREATE UNIQUE INDEX migration_batch_one_cutover ON migration_batch(company_id) WHERE kind='BALANCES';
CREATE FUNCTION migration_batch_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'migration history is immutable' USING ERRCODE='AL004'; END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'migration requires read committed' USING ERRCODE='AL004'; END IF;
 IF app_tenant_role() IS DISTINCT FROM 'OWNER' OR NEW.company_id IS DISTINCT FROM app_tenant_id() OR NEW.created_by_id IS DISTINCT FROM app_current_user_id() THEN
  RAISE EXCEPTION 'company administrator required' USING ERRCODE='42501';
 END IF;
 IF (NEW.kind IN ('CUSTOMERS','SUPPLIERS') AND app_module_level('contacts')<>'write') OR
    (NEW.kind='ITEMS' AND app_module_level('catalog')<>'write') OR
    (NEW.kind IN ('ACCOUNTS','BALANCES') AND app_module_level('accounting')<>'write') THEN
  RAISE EXCEPTION 'module write access required' USING ERRCODE='42501';
 END IF;
 IF NEW.kind='BALANCES' AND NOT EXISTS(SELECT 1 FROM journal_entry WHERE company_id=NEW.company_id AND id=NEW.journal_entry_id AND source_type='OPENING_BALANCE' AND created_by_id=NEW.created_by_id) THEN
  RAISE EXCEPTION 'opening entry required' USING ERRCODE='AL004';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER migration_batch_guard BEFORE INSERT OR UPDATE OR DELETE ON migration_batch FOR EACH ROW EXECUTE FUNCTION migration_batch_guard();
CREATE TRIGGER migration_batch_no_truncate BEFORE TRUNCATE ON migration_batch FOR EACH STATEMENT EXECUTE FUNCTION migration_batch_guard();
CREATE TRIGGER migration_batch_audit AFTER INSERT OR UPDATE OR DELETE ON migration_batch FOR EACH ROW EXECUTE FUNCTION audit_row_change();
ALTER TABLE migration_batch ENABLE ROW LEVEL SECURITY;
ALTER TABLE migration_batch FORCE ROW LEVEL SECURITY;
CREATE POLICY admin_read ON migration_batch FOR SELECT USING(company_id=(SELECT app_tenant_id()) AND (SELECT app_tenant_role())='OWNER');
CREATE POLICY admin_insert ON migration_batch FOR INSERT WITH CHECK(company_id=(SELECT app_tenant_id()) AND created_by_id=(SELECT app_current_user_id()) AND (SELECT app_tenant_role())='OWNER');
GRANT SELECT,INSERT ON migration_batch TO allumi_app;
REVOKE EXECUTE ON FUNCTION migration_batch_guard() FROM PUBLIC;
COMMIT;
