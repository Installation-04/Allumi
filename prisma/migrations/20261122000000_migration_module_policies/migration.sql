BEGIN;
CREATE POLICY module_read ON migration_batch AS RESTRICTIVE FOR SELECT USING(
 (SELECT app_module_level(CASE WHEN kind IN ('CUSTOMERS','SUPPLIERS') THEN 'contacts' WHEN kind='ITEMS' THEN 'catalog' ELSE 'accounting' END))<>'none'
);
CREATE POLICY module_insert ON migration_batch AS RESTRICTIVE FOR INSERT WITH CHECK(
 (SELECT app_module_level(CASE WHEN kind IN ('CUSTOMERS','SUPPLIERS') THEN 'contacts' WHEN kind='ITEMS' THEN 'catalog' ELSE 'accounting' END))='write'
);
COMMIT;
