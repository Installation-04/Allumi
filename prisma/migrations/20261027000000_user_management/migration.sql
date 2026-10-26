-- USER has operational directory access, but cannot write accounting records.
ALTER TYPE member_role ADD VALUE 'USER';
ALTER TABLE membership ADD COLUMN module_access jsonb NOT NULL DEFAULT '{}';
ALTER TABLE invitation ADD COLUMN module_access jsonb NOT NULL DEFAULT '{}';
GRANT UPDATE (module_access) ON membership TO allumi_app;
CREATE FUNCTION valid_module_access(value jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_typeof(value) = 'object' AND NOT EXISTS (
   SELECT 1 FROM jsonb_each_text(CASE WHEN jsonb_typeof(value) = 'object' THEN value ELSE '{}'::jsonb END)
   WHERE key NOT IN ('contacts','catalog','sales','accounting','taxes','audit') OR value IS NULL OR value NOT IN ('none','read','write')
 )
$$;
REVOKE ALL ON FUNCTION valid_module_access(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION valid_module_access(jsonb) TO allumi_app;
ALTER TABLE membership ADD CONSTRAINT membership_module_access_valid CHECK (valid_module_access(module_access));
ALTER TABLE invitation ADD CONSTRAINT invitation_module_access_valid CHECK (valid_module_access(module_access));
CREATE FUNCTION app_module_level(p_module text) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r text; permissions jsonb; access text;
BEGIN
 SELECT m.role::text, m.module_access INTO r, permissions FROM public.membership m
 JOIN public.app_user u ON u.id=m.user_id AND u.disabled_at IS NULL
 WHERE m.company_id=NULLIF(current_setting('app.company_id',true),'')::uuid AND m.user_id=app_current_user_id();
 IF r IS NULL THEN RETURN 'none'; END IF;
 IF r='OWNER' THEN RETURN 'write'; END IF;
 access := permissions->>p_module;
 IF access IS NULL THEN
   access := CASE WHEN r='ACCOUNTANT' THEN 'write' WHEN p_module='audit' THEN 'none'
    WHEN r='USER' AND p_module IN ('contacts','catalog') THEN 'write' ELSE 'read' END;
 END IF;
 IF r='READ_ONLY' AND access='write' THEN RETURN 'read'; END IF;
 RETURN access;
END $$;
REVOKE ALL ON FUNCTION app_module_level(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_module_level(text) TO allumi_app, allumi_redactor;
CREATE OR REPLACE FUNCTION app_can_write() RETURNS boolean LANGUAGE sql STABLE
AS $$ SELECT coalesce(app_tenant_role()::text IN ('OWNER','ACCOUNTANT','USER'),false) $$;
-- Restrictive policies are combined with the existing tenant policies, never replacing tenant isolation.
DO $$
DECLARE t text; m text;
BEGIN
 FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 JOIN pg_attribute a ON a.attrelid=c.oid AND a.attname='company_id' AND NOT a.attisdropped
 WHERE n.nspname='public' AND c.relkind='r' AND c.relname NOT IN ('membership','invitation') LOOP
   m := CASE WHEN t='contact' THEN 'contacts' WHEN t='item' THEN 'catalog'
    WHEN t LIKE 'sales_%' THEN 'sales' WHEN t LIKE 'tax%' THEN 'taxes'
    WHEN t='audit_log' THEN 'audit' ELSE 'accounting' END;
   -- Global authentication events remain readable by their subject under the original policy.
   EXECUTE format('CREATE POLICY module_read ON %I AS RESTRICTIVE FOR SELECT USING (company_id IS NULL OR (SELECT app_module_level(%L)) <> ''none'')',t,m);
   IF t <> 'audit_log' THEN
     EXECUTE format('CREATE POLICY module_insert ON %I AS RESTRICTIVE FOR INSERT WITH CHECK ((SELECT app_module_level(%L)) = ''write'')',t,m);
     EXECUTE format('CREATE POLICY module_update ON %I AS RESTRICTIVE FOR UPDATE USING ((SELECT app_module_level(%L)) = ''write'') WITH CHECK ((SELECT app_module_level(%L)) = ''write'')',t,m,m);
     EXECUTE format('CREATE POLICY module_delete ON %I AS RESTRICTIVE FOR DELETE USING ((SELECT app_module_level(%L)) = ''write'')',t,m);
   END IF;
 END LOOP;
END $$;
-- Accountants must never be able to invite an administrator (including via direct SQL).
DROP POLICY tenant_read ON invitation;
DROP POLICY tenant_insert ON invitation;
DROP POLICY tenant_update ON invitation;
DROP POLICY tenant_delete ON invitation;
CREATE POLICY invitation_owner ON invitation FOR ALL
  USING (company_id = (SELECT app_tenant_id()) AND (SELECT app_tenant_role()) = 'OWNER')
  WITH CHECK (company_id = (SELECT app_tenant_id()) AND (SELECT app_tenant_role()) = 'OWNER');
CREATE POLICY invitation_creator ON invitation AS RESTRICTIVE FOR INSERT
  WITH CHECK (created_by_id = app_current_user_id());

-- Acceptance is a narrow capability. Existing accounts require their own authenticated context;
-- a token can never reset a password, bypass MFA, or replace an existing membership's role.
CREATE FUNCTION app_accept_invitation(p_hash text, p_email text, p_name text, p_password_hash text, p_locale app_locale)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE i public.invitation; u public.app_user; cid uuid; uid uuid;
BEGIN
  SELECT company_id INTO cid FROM public.invitation WHERE token_hash = p_hash;
  IF cid IS NULL THEN RETURN NULL; END IF;
  -- Same lock order as membership changes: company first, then invitation.
  PERFORM 1 FROM public.company WHERE id = cid FOR UPDATE;
  SELECT * INTO i FROM public.invitation WHERE token_hash = p_hash FOR UPDATE;
  IF i.accepted_at IS NOT NULL OR i.revoked_at IS NOT NULL OR i.expires_at <= now()
     OR i.email <> p_email OR NOT EXISTS (
       SELECT 1 FROM public.membership m JOIN public.app_user a ON a.id = m.user_id
       WHERE m.company_id = i.company_id AND m.user_id = i.created_by_id AND m.role = 'OWNER' AND a.disabled_at IS NULL
     ) THEN RETURN NULL; END IF;
  SELECT * INTO u FROM public.app_user WHERE email = i.email;
  IF FOUND THEN
    IF u.disabled_at IS NOT NULL OR u.id IS DISTINCT FROM app_current_user_id() THEN RETURN NULL; END IF;
    uid := u.id;
    IF EXISTS (SELECT 1 FROM public.membership WHERE company_id = cid AND user_id = uid) THEN RETURN NULL; END IF;
  ELSE
    IF app_current_user_id() IS NOT NULL OR p_password_hash IS NULL OR length(p_password_hash) < 30
       OR p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 120 THEN RETURN NULL; END IF;
    uid := gen_random_uuid();
    PERFORM set_config('app.user_id', uid::text, true);
    INSERT INTO public.app_user(id, email, display_name, locale, updated_at)
      VALUES(uid, i.email, btrim(p_name), p_locale, now());
    INSERT INTO public.user_credential(user_id, password_hash, password_changed_at, updated_at)
      VALUES(uid, p_password_hash, now(), now());
  END IF;
  INSERT INTO public.membership(id, company_id, user_id, role, module_access, updated_at)
    VALUES(gen_random_uuid(), cid, uid, i.role, i.module_access, now());
  UPDATE public.invitation SET accepted_at = now() WHERE id = i.id;
  RETURN cid;
END $$;
REVOKE ALL ON FUNCTION app_accept_invitation(text, text, text, text, app_locale) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_accept_invitation(text, text, text, text, app_locale) TO allumi_app;
-- A viewer may be explicitly given audit read access, but never writes.
DROP POLICY audit_log_read ON audit_log;
CREATE POLICY audit_log_read ON audit_log FOR SELECT
 USING ((company_id=(SELECT app_tenant_id()) AND (SELECT app_module_level('audit')) <> 'none')
 OR (company_id IS NULL AND (actor_user_id=app_current_user_id() OR subject_user_id=app_current_user_id())));
-- Invitation digests are authentication material; never copy them into the audit payload.
DROP TRIGGER invitation_audit ON invitation;
CREATE TRIGGER invitation_audit AFTER INSERT OR UPDATE OR DELETE ON invitation
 FOR EACH ROW EXECUTE FUNCTION audit_row_change('token_hash');
