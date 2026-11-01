BEGIN;
ALTER TABLE attachment ADD COLUMN scope text NOT NULL DEFAULT 'accounting';
ALTER TABLE attachment ADD CONSTRAINT attachment_scope CHECK (scope IN ('accounting','sales'));
-- Preserve old mixed/unknown links under their original accounting permissions.
ALTER TABLE attachment DISABLE TRIGGER attachment_guard;
UPDATE attachment a SET scope='sales' WHERE EXISTS (SELECT 1 FROM attachment_link l WHERE l.company_id=a.company_id AND l.attachment_id=a.id AND l.sales_document_id IS NOT NULL)
 AND NOT EXISTS (SELECT 1 FROM attachment_link l WHERE l.company_id=a.company_id AND l.attachment_id=a.id AND l.sales_document_id IS NULL);
ALTER TABLE attachment ENABLE TRIGGER attachment_guard;
DROP POLICY module_read ON attachment;
DROP POLICY module_insert ON attachment;
DROP POLICY module_update ON attachment;
DROP POLICY module_delete ON attachment;
CREATE POLICY module_read ON attachment AS RESTRICTIVE FOR SELECT USING (app_module_level(scope)<>'none');
CREATE POLICY module_insert ON attachment AS RESTRICTIVE FOR INSERT WITH CHECK (app_module_level(scope)='write');
CREATE POLICY module_update ON attachment AS RESTRICTIVE FOR UPDATE USING (app_module_level(scope)='write') WITH CHECK (app_module_level(scope)='write');
CREATE POLICY module_delete ON attachment AS RESTRICTIVE FOR DELETE USING (app_module_level(scope)='write');
DROP POLICY module_read ON attachment_link;
DROP POLICY module_insert ON attachment_link;
DROP POLICY module_update ON attachment_link;
DROP POLICY module_delete ON attachment_link;
CREATE POLICY module_read ON attachment_link AS RESTRICTIVE FOR SELECT USING (app_module_level(CASE WHEN sales_document_id IS NOT NULL THEN 'sales' ELSE 'accounting' END)<>'none');
CREATE POLICY module_insert ON attachment_link AS RESTRICTIVE FOR INSERT WITH CHECK (app_module_level(CASE WHEN sales_document_id IS NOT NULL THEN 'sales' ELSE 'accounting' END)='write');
CREATE POLICY module_update ON attachment_link AS RESTRICTIVE FOR UPDATE USING (app_module_level(CASE WHEN sales_document_id IS NOT NULL THEN 'sales' ELSE 'accounting' END)='write') WITH CHECK (app_module_level(CASE WHEN sales_document_id IS NOT NULL THEN 'sales' ELSE 'accounting' END)='write');
CREATE POLICY module_delete ON attachment_link AS RESTRICTIVE FOR DELETE USING (app_module_level(CASE WHEN sales_document_id IS NOT NULL THEN 'sales' ELSE 'accounting' END)='write');
CREATE FUNCTION attachment_scope_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM attachment WHERE company_id=NEW.company_id AND id=NEW.attachment_id AND deleted_at IS NULL AND scope=CASE WHEN NEW.sales_document_id IS NOT NULL THEN 'sales' ELSE 'accounting' END) THEN
  RAISE EXCEPTION 'attachment scope must match its target' USING ERRCODE='AL004';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION attachment_scope_guard() FROM PUBLIC;
CREATE TRIGGER attachment_scope_guard BEFORE INSERT OR UPDATE ON attachment_link FOR EACH ROW EXECUTE FUNCTION attachment_scope_guard();

COMMIT;
