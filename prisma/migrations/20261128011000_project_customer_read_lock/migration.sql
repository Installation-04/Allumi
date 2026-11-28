BEGIN;
-- FOR SHARE also applies contact UPDATE policies. This narrow capability locks a
-- readable customer without granting Contacts write or returning personal data.
CREATE FUNCTION project_lock_customer(p_company UUID,p_customer UUID) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF p_company IS NULL OR p_customer IS NULL OR p_company IS DISTINCT FROM public.app_tenant_id()
 OR public.app_can_write() IS NOT TRUE
 OR public.app_module_level('accounting') IS DISTINCT FROM 'write'
 OR coalesce(public.app_module_level('contacts'),'none') NOT IN ('read','write') THEN
  RAISE EXCEPTION 'project client lock not authorized' USING ERRCODE='42501';
 END IF;
 PERFORM 1 FROM public.contact WHERE company_id=p_company AND id=p_customer
 AND is_customer AND is_active AND anonymized_at IS NULL FOR SHARE;
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION project_lock_customer(UUID,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION project_lock_customer(UUID,UUID) TO allumi_app;
CREATE OR REPLACE FUNCTION project_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'archive projects instead of deleting them' USING ERRCODE='AL004'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.revision<>1 OR NEW.status<>'ACTIVE' THEN RAISE EXCEPTION 'project starts active at revision one' USING ERRCODE='AL004'; END IF;
 ELSE
  IF (NEW.id,NEW.company_id,NEW.code,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.company_id,OLD.code,OLD.created_at) OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'immutable project scope/code or stale revision' USING ERRCODE='AL004'; END IF;
  IF (OLD.status='ARCHIVED' OR NEW.status<>OLD.status) AND (NEW.name,NEW.description,NEW.customer_id) IS DISTINCT FROM (OLD.name,OLD.description,OLD.customer_id) THEN RAISE EXCEPTION 'reactivate before editing an archived project' USING ERRCODE='AL004'; END IF;
 END IF;
 IF NEW.customer_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.customer_id IS DISTINCT FROM OLD.customer_id) THEN
  IF app_module_level('contacts')='none' THEN RAISE EXCEPTION 'contact read required to assign a client' USING ERRCODE='AL004'; END IF;
  IF NOT public.project_lock_customer(NEW.company_id,NEW.customer_id) THEN RAISE EXCEPTION 'unavailable project client' USING ERRCODE='AL004'; END IF;
 END IF;
 -- Clearing a link is also a change to the client association.
 IF TG_OP='UPDATE' AND NEW.customer_id IS DISTINCT FROM OLD.customer_id AND app_module_level('contacts')='none' THEN RAISE EXCEPTION 'contact read required to change a client' USING ERRCODE='AL004'; END IF;
 RETURN NEW;
END $$;
COMMIT;
