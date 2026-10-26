-- Rapprochement bancaire, étape 2 : l'appariement des lignes de relevé et des écritures.
--
-- Une transaction bancaire appariée à une ligne de grand livre garde son lien tant qu'un rapprochement compte cette
-- ligne : défaire l'appariement changerait ce que le relevé a prouvé. Il faut d'abord rouvrir le rapprochement.
-- (La somme des lignes appariées, leur compte et l'état de la transaction sont déjà contrôlés par
-- `bank_transaction_match_check`; une écriture BANK vient toujours d'une transaction bancaire de la société.)

CREATE FUNCTION bank_match_reconciled_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM reconciled_line WHERE company_id = OLD.company_id AND journal_line_id = OLD.journal_line_id) THEN
    RAISE EXCEPTION 'a match cannot be removed while a reconciliation counts its line' USING ERRCODE = 'AL010';
  END IF;
  RETURN OLD;
END $$;

CREATE TRIGGER bank_match_reconciled
  BEFORE DELETE ON bank_match FOR EACH ROW EXECUTE FUNCTION bank_match_reconciled_guard();

-- Comme toutes les fonctions du schéma : rien n'est appelable par PUBLIC.
REVOKE EXECUTE ON FUNCTION bank_match_reconciled_guard() FROM PUBLIC;
