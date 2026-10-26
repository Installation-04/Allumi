ALTER TABLE app_user ADD COLUMN can_manage_server boolean NOT NULL DEFAULT false;
-- Only the super administrator may delegate the global server capability; profile grants exclude this column.
CREATE FUNCTION app_set_server_access(p_user uuid, p_enabled boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
 IF NOT app_is_instance_admin() THEN RAISE EXCEPTION 'super administrator required' USING ERRCODE='42501'; END IF;
 UPDATE public.app_user SET can_manage_server=p_enabled, updated_at=now() WHERE id=p_user AND disabled_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'active user required' USING ERRCODE='42501'; END IF;
END $$;
REVOKE ALL ON FUNCTION app_set_server_access(uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_set_server_access(uuid,boolean) TO allumi_app;
