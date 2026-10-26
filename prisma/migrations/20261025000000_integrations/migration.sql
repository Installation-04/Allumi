
-- CreateEnum
CREATE TYPE "integration_provider" AS ENUM ('STRIPE', 'PAYPAL');

-- CreateEnum
CREATE TYPE "integration_status" AS ENUM ('ACTIVE', 'DISABLED');

-- AlterTable
ALTER TABLE "bank_transaction" ADD COLUMN     "connection_id" UUID,
ADD COLUMN     "currency" CHAR(3) NOT NULL DEFAULT 'CAD',
ADD COLUMN     "fee_cents" BIGINT,
ADD COLUMN     "gross_cents" BIGINT,
ADD COLUMN     "provider_details" JSONB,
ADD COLUMN     "source_type" TEXT;

-- CreateTable
CREATE TABLE "integration_connection" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "provider" "integration_provider" NOT NULL,
    "label" TEXT NOT NULL,
    "account_id" UUID NOT NULL,
    "status" "integration_status" NOT NULL DEFAULT 'ACTIVE',
    "sandbox" BOOLEAN NOT NULL DEFAULT false,
    "credentials_hint" TEXT,
    "import_from" DATE NOT NULL,
    "sync_cursor" TIMESTAMPTZ(6),
    "last_synced_at" TIMESTAMPTZ(6),
    "last_sync_ok" BOOLEAN,
    "last_error" TEXT,
    "last_imported_count" INTEGER,
    "syncing_since" TIMESTAMPTZ(6),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "integration_connection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_credential" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "credentials_enc" BYTEA,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "integration_credential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "integration_connection_company_id_account_id_idx" ON "integration_connection"("company_id", "account_id");

-- CreateIndex
CREATE UNIQUE INDEX "integration_connection_company_id_id_key" ON "integration_connection"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "integration_connection_company_id_provider_label_key" ON "integration_connection"("company_id", "provider", "label");

-- CreateIndex
CREATE UNIQUE INDEX "integration_credential_company_id_connection_id_key" ON "integration_credential"("company_id", "connection_id");

-- CreateIndex
CREATE INDEX "bank_transaction_company_id_connection_id_idx" ON "bank_transaction"("company_id", "connection_id");

-- AddForeignKey
ALTER TABLE "bank_transaction" ADD CONSTRAINT "bank_transaction_company_id_connection_id_fkey" FOREIGN KEY ("company_id", "connection_id") REFERENCES "integration_connection"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_connection" ADD CONSTRAINT "integration_connection_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_connection" ADD CONSTRAINT "integration_connection_company_id_account_id_fkey" FOREIGN KEY ("company_id", "account_id") REFERENCES "account"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_credential" ADD CONSTRAINT "integration_credential_company_id_connection_id_fkey" FOREIGN KEY ("company_id", "connection_id") REFERENCES "integration_connection"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------
-- Intégrations : contraintes, gardes, isolation, droits et audit
-- ---------------------------------------------------------------------
ALTER TABLE integration_connection
  ADD CONSTRAINT integration_connection_label CHECK (label = btrim(label) AND char_length(label) BETWEEN 1 AND 60),
  ADD CONSTRAINT integration_connection_import_from CHECK (import_from >= DATE '2000-01-01'),
  -- Un code (« integrations.unauthorized »), jamais le texte du service : il pourrait citer des données.
  ADD CONSTRAINT integration_connection_last_error CHECK (last_error IS NULL OR last_error ~ '^[a-z][a-zA-Z0-9_.]{0,63}$'),
  ADD CONSTRAINT integration_connection_imported_count CHECK (last_imported_count IS NULL OR last_imported_count >= 0),
  -- Seulement de quoi reconnaître la clé : quelques caractères, jamais le secret.
  ADD CONSTRAINT integration_connection_hint CHECK (credentials_hint IS NULL OR char_length(credentials_hint) <= 8);

-- Une transaction importée porte sa connexion, son type d'origine et un identifiant externe; brut − frais = net.
ALTER TABLE bank_transaction
  ADD CONSTRAINT bank_transaction_currency CHECK (currency ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT bank_transaction_imported CHECK (
    (connection_id IS NULL) = (source_type IS NULL)
    AND (connection_id IS NULL OR external_id IS NOT NULL)),
  ADD CONSTRAINT bank_transaction_gross_fee CHECK (
    (gross_cents IS NULL) = (fee_cents IS NULL)
    AND (gross_cents IS NULL OR connection_id IS NOT NULL)
    AND (gross_cents IS NULL OR gross_cents - fee_cents = amount_cents));

-- La connexion alimente un compte de banque, de caisse ou de carte (comme un relevé).
CREATE TRIGGER integration_connection_account
  BEFORE INSERT ON integration_connection FOR EACH ROW EXECUTE FUNCTION bank_account_check();

-- Jamais supprimée; ni le service, ni le compte, ni l'environnement ne changent : on en crée une autre.
CREATE FUNCTION integration_connection_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_mutable text[] := ARRAY['label', 'status', 'credentials_hint', 'sync_cursor', 'last_synced_at', 'last_sync_ok',
                            'last_error', 'last_imported_count', 'syncing_since', 'updated_at'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'integration connections are never deleted; disable them' USING ERRCODE = 'AL010';
  END IF;
  IF (to_jsonb(NEW) - v_mutable) IS DISTINCT FROM (to_jsonb(OLD) - v_mutable) THEN
    RAISE EXCEPTION 'the service, the account and the environment of a connection do not change' USING ERRCODE = 'AL010';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER integration_connection_guard
  BEFORE UPDATE OR DELETE ON integration_connection FOR EACH ROW EXECUTE FUNCTION integration_connection_guard();

CREATE FUNCTION integration_credential_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'credentials are cleared, never deleted' USING ERRCODE = 'AL010';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['credentials_enc', 'updated_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['credentials_enc', 'updated_at']) THEN
    RAISE EXCEPTION 'only the credentials of a connection can change' USING ERRCODE = 'AL010';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER integration_credential_guard
  BEFORE UPDATE OR DELETE ON integration_credential FOR EACH ROW EXECUTE FUNCTION integration_credential_guard();

-- Une transaction importée arrive sur le compte de sa connexion, et seulement par une connexion active.
CREATE FUNCTION bank_transaction_connection_check() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  c integration_connection%ROWTYPE;
BEGIN
  IF NEW.connection_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO c FROM integration_connection WHERE company_id = NEW.company_id AND id = NEW.connection_id;
  IF NOT FOUND OR c.account_id IS DISTINCT FROM NEW.account_id THEN
    RAISE EXCEPTION 'an imported transaction belongs to the account of its connection' USING ERRCODE = 'AL010';
  END IF;
  IF c.status::text <> 'ACTIVE' THEN
    RAISE EXCEPTION 'a disabled connection imports nothing' USING ERRCODE = 'AL010';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER bank_transaction_connection
  BEFORE INSERT ON bank_transaction FOR EACH ROW EXECUTE FUNCTION bank_transaction_connection_check();

-- Isolation par entreprise. Tous les membres voient les connexions (service, étiquette, état de la dernière
-- synchronisation); seul le propriétaire en crée et en modifie, et seul lui lit les identifiants chiffrés.
ALTER TABLE integration_connection ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_connection FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON integration_connection FOR SELECT
  USING (company_id = (SELECT app_tenant_id()));
CREATE POLICY owner_insert ON integration_connection FOR INSERT
  WITH CHECK (company_id = (SELECT app_tenant_id()) AND (SELECT app_tenant_role()) = 'OWNER');
CREATE POLICY owner_update ON integration_connection FOR UPDATE
  USING (company_id = (SELECT app_tenant_id()) AND (SELECT app_tenant_role()) = 'OWNER')
  WITH CHECK (company_id = (SELECT app_tenant_id()) AND (SELECT app_tenant_role()) = 'OWNER');

ALTER TABLE integration_credential ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_credential FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_read ON integration_credential FOR SELECT
  USING (company_id = (SELECT app_tenant_id()) AND (SELECT app_tenant_role()) = 'OWNER');
CREATE POLICY owner_insert ON integration_credential FOR INSERT
  WITH CHECK (company_id = (SELECT app_tenant_id()) AND (SELECT app_tenant_role()) = 'OWNER');
CREATE POLICY owner_update ON integration_credential FOR UPDATE
  USING (company_id = (SELECT app_tenant_id()) AND (SELECT app_tenant_role()) = 'OWNER')
  WITH CHECK (company_id = (SELECT app_tenant_id()) AND (SELECT app_tenant_role()) = 'OWNER');

-- Droits : ni suppression ni TRUNCATE. Les colonnes d'une connexion qui ne changent jamais restent hors d'UPDATE.
GRANT SELECT, INSERT ON integration_connection TO allumi_app;
GRANT UPDATE (label, status, credentials_hint, sync_cursor, last_synced_at, last_sync_ok, last_error,
              last_imported_count, syncing_since, updated_at) ON integration_connection TO allumi_app;
GRANT SELECT, INSERT ON integration_credential TO allumi_app;
GRANT UPDATE (credentials_enc, updated_at) ON integration_credential TO allumi_app;

-- Audit : le changement est consigné, mais jamais l'identifiant chiffré (seulement « _secrets_changed »), et les
-- champs de synchronisation, qui bougent à chaque passage, n'ajoutent pas de bruit.
CREATE TRIGGER integration_connection_audit
  AFTER INSERT OR UPDATE OR DELETE ON integration_connection FOR EACH ROW
  EXECUTE FUNCTION audit_row_change('--', 'sync_cursor', 'last_synced_at', 'last_sync_ok', 'last_error', 'last_imported_count', 'syncing_since');
CREATE TRIGGER integration_credential_audit
  AFTER INSERT OR UPDATE OR DELETE ON integration_credential FOR EACH ROW
  EXECUTE FUNCTION audit_row_change('credentials_enc');

-- Comme toutes les fonctions du schéma : rien n'est appelable par PUBLIC.
REVOKE EXECUTE ON FUNCTION integration_connection_guard(), integration_credential_guard(), bank_transaction_connection_check() FROM PUBLIC;
