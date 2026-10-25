
-- CreateEnum
CREATE TYPE "payment_link_status" AS ENUM ('PENDING', 'ACTIVE', 'PAID', 'REVIEW', 'CANCELLED');

-- AlterTable
ALTER TABLE "integration_connection" ADD COLUMN     "fee_account_id" UUID;

-- CreateTable
CREATE TABLE "payment_link" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "status" "payment_link_status" NOT NULL DEFAULT 'PENDING',
    "amount_cents" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'CAD',
    "external_price_id" TEXT,
    "external_id" TEXT,
    "url" TEXT,
    "last_error" TEXT,
    "review_reason" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payment_link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "online_payment" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "link_id" UUID NOT NULL,
    "provider_ref" TEXT NOT NULL,
    "payment_id" UUID NOT NULL,
    "fee_entry_id" UUID,
    "gross_cents" BIGINT NOT NULL,
    "fee_cents" BIGINT NOT NULL,
    "net_cents" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "paid_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "online_payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_link_company_id_invoice_id_idx" ON "payment_link"("company_id", "invoice_id");

-- CreateIndex
CREATE INDEX "payment_link_company_id_status_idx" ON "payment_link"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payment_link_company_id_id_key" ON "payment_link"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_link_connection_id_external_id_key" ON "payment_link"("connection_id", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_link_one_live_per_invoice" ON "payment_link"("company_id", "invoice_id") WHERE (status = 'PENDING' OR status = 'ACTIVE');

-- CreateIndex
CREATE UNIQUE INDEX "online_payment_company_id_id_key" ON "online_payment"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "online_payment_company_id_link_id_key" ON "online_payment"("company_id", "link_id");

-- CreateIndex
CREATE UNIQUE INDEX "online_payment_company_id_provider_ref_key" ON "online_payment"("company_id", "provider_ref");

-- CreateIndex
CREATE UNIQUE INDEX "online_payment_company_id_payment_id_key" ON "online_payment"("company_id", "payment_id");

-- AddForeignKey
ALTER TABLE "integration_connection" ADD CONSTRAINT "integration_connection_company_id_fee_account_id_fkey" FOREIGN KEY ("company_id", "fee_account_id") REFERENCES "account"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_link" ADD CONSTRAINT "payment_link_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_link" ADD CONSTRAINT "payment_link_company_id_invoice_id_fkey" FOREIGN KEY ("company_id", "invoice_id") REFERENCES "sales_document"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_link" ADD CONSTRAINT "payment_link_company_id_connection_id_fkey" FOREIGN KEY ("company_id", "connection_id") REFERENCES "integration_connection"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "online_payment" ADD CONSTRAINT "online_payment_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "online_payment" ADD CONSTRAINT "online_payment_company_id_link_id_fkey" FOREIGN KEY ("company_id", "link_id") REFERENCES "payment_link"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "online_payment" ADD CONSTRAINT "online_payment_company_id_payment_id_fkey" FOREIGN KEY ("company_id", "payment_id") REFERENCES "payment"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "online_payment" ADD CONSTRAINT "online_payment_company_id_fee_entry_id_fkey" FOREIGN KEY ("company_id", "fee_entry_id") REFERENCES "journal_entry"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ---------------------------------------------------------------------
-- Paiement en ligne : contraintes, gardes, isolation, droits et audit
-- ---------------------------------------------------------------------
ALTER TABLE payment_link
  ADD CONSTRAINT payment_link_amount CHECK (amount_cents > 0 AND amount_cents <= 100000000000000),
  ADD CONSTRAINT payment_link_currency CHECK (currency ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT payment_link_url CHECK (url IS NULL OR (url ~ '^https://[^[:space:]]+$' AND char_length(url) <= 500)),
  ADD CONSTRAINT payment_link_external_id CHECK (external_id IS NULL OR external_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  ADD CONSTRAINT payment_link_external_price_id CHECK (external_price_id IS NULL OR external_price_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  -- Des codes (« integrations.unauthorized », « payments.exceeds »), jamais le texte du service : il pourrait citer des données.
  ADD CONSTRAINT payment_link_last_error CHECK (last_error IS NULL OR last_error ~ '^[a-z][a-zA-Z0-9_.]{0,63}$'),
  ADD CONSTRAINT payment_link_review_reason CHECK (review_reason IS NULL OR review_reason ~ '^[a-z][a-zA-Z0-9_.]{0,63}$'),
  ADD CONSTRAINT payment_link_external_pair CHECK ((external_id IS NULL) = (url IS NULL)),
  -- Créé ici (PENDING), puis lié au service (ACTIVE, avec son adresse); un paiement à vérifier (REVIEW) dit pourquoi.
  ADD CONSTRAINT payment_link_state CHECK (
    (status = 'PENDING' AND external_id IS NULL AND review_reason IS NULL)
    OR (status IN ('ACTIVE', 'PAID') AND external_id IS NOT NULL AND review_reason IS NULL)
    OR (status = 'REVIEW' AND external_id IS NOT NULL AND review_reason IS NOT NULL)
    OR status = 'CANCELLED');

ALTER TABLE online_payment
  ADD CONSTRAINT online_payment_amounts CHECK (
    gross_cents > 0 AND gross_cents <= 100000000000000 AND fee_cents >= 0 AND fee_cents <= gross_cents
    AND net_cents = gross_cents - fee_cents),
  ADD CONSTRAINT online_payment_currency CHECK (currency ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT online_payment_provider_ref CHECK (provider_ref ~ '^[A-Za-z0-9_-]{1,100}$'),
  -- Une écriture de frais s'il y a des frais, et seulement alors.
  ADD CONSTRAINT online_payment_fee_entry CHECK ((fee_cents = 0) = (fee_entry_id IS NULL));

-- Les frais de traitement vont à un compte de charges (choisi par le propriétaire, modifiable : il ne vaut que pour la suite).
CREATE FUNCTION integration_connection_fee_account_check() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.fee_account_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.fee_account_id IS DISTINCT FROM OLD.fee_account_id) THEN
    PERFORM assert_account_subtype(NEW.company_id, NEW.fee_account_id,
      ARRAY['OPERATING_EXPENSE', 'OTHER_EXPENSE']::account_subtype[], 'processing fee account');
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER integration_connection_fee_account
  BEFORE INSERT OR UPDATE ON integration_connection FOR EACH ROW EXECUTE FUNCTION integration_connection_fee_account_check();

-- Même garde qu'avant; le compte des frais peut maintenant changer.
CREATE OR REPLACE FUNCTION integration_connection_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_mutable text[] := ARRAY['label', 'status', 'credentials_hint', 'fee_account_id', 'sync_cursor', 'last_synced_at', 'last_sync_ok',
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

-- Un lien de paiement n'est jamais supprimé. Il naît « en attente » pour une facture validée et au plus son solde, sur
-- une connexion Stripe active qui sait où mettre les frais; ensuite seuls son état et ce qui le lie au service changent,
-- une seule fois, et un lien payé ou annulé ne bouge plus.
CREATE FUNCTION payment_link_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_mutable text[] := ARRAY['status', 'external_price_id', 'external_id', 'url', 'last_error', 'review_reason', 'updated_at'];
  inv sales_document%ROWTYPE;
  c integration_connection%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payment links are never deleted; cancel them' USING ERRCODE = 'AL010';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PENDING' THEN
      RAISE EXCEPTION 'payment links are created pending' USING ERRCODE = 'AL010';
    END IF;
    SELECT * INTO inv FROM sales_document WHERE company_id = NEW.company_id AND id = NEW.invoice_id;
    IF NOT FOUND OR inv.kind <> 'INVOICE' OR inv.status <> 'POSTED' OR inv.currency IS DISTINCT FROM NEW.currency THEN
      RAISE EXCEPTION 'a payment link is for a posted invoice, in its currency' USING ERRCODE = 'AL010';
    END IF;
    SELECT * INTO c FROM integration_connection WHERE company_id = NEW.company_id AND id = NEW.connection_id;
    IF NOT FOUND OR c.provider::text <> 'STRIPE' OR c.status::text <> 'ACTIVE' OR c.fee_account_id IS NULL THEN
      RAISE EXCEPTION 'a payment link needs an active Stripe connection with a processing fee account' USING ERRCODE = 'AL010';
    END IF;
    IF NEW.amount_cents > sales_document_open_cents(NEW.company_id, NEW.invoice_id) THEN
      RAISE EXCEPTION 'a payment link is for at most the open balance of its invoice' USING ERRCODE = 'AL010';
    END IF;
    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - v_mutable) IS DISTINCT FROM (to_jsonb(OLD) - v_mutable) THEN
    RAISE EXCEPTION 'only the state of a payment link changes' USING ERRCODE = 'AL010';
  END IF;
  IF OLD.status::text IN ('PAID', 'CANCELLED') THEN
    RAISE EXCEPTION 'a paid or cancelled payment link no longer changes' USING ERRCODE = 'AL010';
  END IF;
  IF OLD.status <> NEW.status AND (OLD.status::text, NEW.status::text) NOT IN
       (('PENDING', 'ACTIVE'), ('PENDING', 'CANCELLED'), ('ACTIVE', 'PAID'), ('ACTIVE', 'REVIEW'), ('ACTIVE', 'CANCELLED'), ('REVIEW', 'CANCELLED')) THEN
    RAISE EXCEPTION 'payment link: % cannot become %', OLD.status, NEW.status USING ERRCODE = 'AL010';
  END IF;
  IF (OLD.external_id IS NOT NULL AND NEW.external_id IS DISTINCT FROM OLD.external_id)
     OR (OLD.url IS NOT NULL AND NEW.url IS DISTINCT FROM OLD.url)
     OR (OLD.external_price_id IS NOT NULL AND NEW.external_price_id IS DISTINCT FROM OLD.external_price_id) THEN
    RAISE EXCEPTION 'what ties a payment link to the service is set once' USING ERRCODE = 'AL010';
  END IF;
  IF NEW.status::text = 'PAID' AND NOT EXISTS (SELECT 1 FROM online_payment WHERE company_id = NEW.company_id AND link_id = NEW.id) THEN
    RAISE EXCEPTION 'a payment link is paid by an online payment' USING ERRCODE = 'AL010';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER payment_link_guard
  BEFORE INSERT OR UPDATE OR DELETE ON payment_link FOR EACH ROW EXECUTE FUNCTION payment_link_guard();

-- Un paiement en ligne s'ajoute et ne change plus. Il arrive sur un lien actif, pour son montant, et son encaissement
-- (reçu, au brut, sur le compte de la connexion) est appliqué à la facture du lien; les frais, s'il y en a, sont une
-- écriture de deux lignes : charge au compte des frais, crédit au compte de la connexion.
CREATE FUNCTION online_payment_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  l payment_link%ROWTYPE;
  c integration_connection%ROWTYPE;
  p payment%ROWTYPE;
  e journal_entry%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'online payments are never changed or deleted' USING ERRCODE = 'AL010';
  END IF;
  SELECT * INTO l FROM payment_link WHERE company_id = NEW.company_id AND id = NEW.link_id;
  IF NOT FOUND OR l.status::text <> 'ACTIVE' THEN
    RAISE EXCEPTION 'an online payment arrives on an active payment link' USING ERRCODE = 'AL010';
  END IF;
  IF NEW.gross_cents <> l.amount_cents OR NEW.currency <> l.currency THEN
    RAISE EXCEPTION 'an online payment is for the amount of its payment link' USING ERRCODE = 'AL010';
  END IF;
  SELECT * INTO c FROM integration_connection WHERE company_id = NEW.company_id AND id = l.connection_id;
  SELECT * INTO p FROM payment WHERE company_id = NEW.company_id AND id = NEW.payment_id;
  IF NOT FOUND OR p.direction::text <> 'RECEIVED' OR p.ledger::text <> 'RECEIVABLE' OR p.status::text <> 'POSTED'
     OR p.amount_cents <> NEW.gross_cents OR p.account_id <> c.account_id THEN
    RAISE EXCEPTION 'the receipt of an online payment is for the gross amount, on the account of the connection' USING ERRCODE = 'AL010';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM payment_allocation a
                  WHERE a.company_id = NEW.company_id AND a.payment_id = p.id AND a.sales_document_id = l.invoice_id
                    AND a.amount_cents = NEW.gross_cents AND a.unapplied_date IS NULL) THEN
    RAISE EXCEPTION 'the receipt of an online payment is applied to the invoice of its payment link' USING ERRCODE = 'AL010';
  END IF;
  IF NEW.fee_entry_id IS NOT NULL THEN
    SELECT * INTO e FROM journal_entry WHERE company_id = NEW.company_id AND id = NEW.fee_entry_id;
    IF NOT FOUND OR e.source_type::text <> 'MANUAL' OR e.reverses_entry_id IS NOT NULL
       OR (SELECT count(*) FROM journal_line WHERE company_id = e.company_id AND entry_id = e.id) <> 2
       OR NOT EXISTS (SELECT 1 FROM journal_line WHERE company_id = e.company_id AND entry_id = e.id
                         AND account_id = c.fee_account_id AND debit_cents = NEW.fee_cents AND credit_cents = 0)
       OR NOT EXISTS (SELECT 1 FROM journal_line WHERE company_id = e.company_id AND entry_id = e.id
                         AND account_id = c.account_id AND credit_cents = NEW.fee_cents AND debit_cents = 0) THEN
      RAISE EXCEPTION 'the fees of an online payment are one entry: processing fee account debited, connection account credited' USING ERRCODE = 'AL010';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER online_payment_guard
  BEFORE INSERT OR UPDATE OR DELETE ON online_payment FOR EACH ROW EXECUTE FUNCTION online_payment_guard();

-- Isolation par entreprise. Tous les membres voient les liens et les paiements en ligne; seul le propriétaire (qui
-- détient les clés) en crée et fait avancer les liens.
ALTER TABLE payment_link ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_link FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON payment_link FOR SELECT
  USING (company_id = (SELECT app_tenant_id()));
CREATE POLICY owner_insert ON payment_link FOR INSERT
  WITH CHECK (company_id = (SELECT app_tenant_id()) AND (SELECT app_tenant_role()) = 'OWNER');
CREATE POLICY owner_update ON payment_link FOR UPDATE
  USING (company_id = (SELECT app_tenant_id()) AND (SELECT app_tenant_role()) = 'OWNER')
  WITH CHECK (company_id = (SELECT app_tenant_id()) AND (SELECT app_tenant_role()) = 'OWNER');

ALTER TABLE online_payment ENABLE ROW LEVEL SECURITY;
ALTER TABLE online_payment FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON online_payment FOR SELECT
  USING (company_id = (SELECT app_tenant_id()));
CREATE POLICY owner_insert ON online_payment FOR INSERT
  WITH CHECK (company_id = (SELECT app_tenant_id()) AND (SELECT app_tenant_role()) = 'OWNER');

-- Droits : ni suppression ni TRUNCATE; les colonnes d'un lien qui ne changent jamais restent hors d'UPDATE.
GRANT UPDATE (fee_account_id) ON integration_connection TO allumi_app;
GRANT SELECT, INSERT ON payment_link TO allumi_app;
GRANT UPDATE (status, external_price_id, external_id, url, last_error, review_reason, updated_at) ON payment_link TO allumi_app;
GRANT SELECT, INSERT ON online_payment TO allumi_app;

-- Audit : toute création et tout changement d'état est consigné (rien de secret : l'adresse d'un lien est faite pour être partagée).
CREATE TRIGGER payment_link_audit
  AFTER INSERT OR UPDATE OR DELETE ON payment_link FOR EACH ROW EXECUTE FUNCTION audit_row_change();
CREATE TRIGGER online_payment_audit
  AFTER INSERT OR UPDATE OR DELETE ON online_payment FOR EACH ROW EXECUTE FUNCTION audit_row_change();

-- Comme toutes les fonctions du schéma : rien n'est appelable par PUBLIC.
REVOKE EXECUTE ON FUNCTION integration_connection_fee_account_check(), payment_link_guard(), online_payment_guard() FROM PUBLIC;
