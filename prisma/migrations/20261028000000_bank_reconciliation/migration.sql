-- Rapprochement bancaire, étape 3 : seul un rapprochement complété fige un appariement.
--
-- `bank_match_reconciled_guard` (20261027000000) refusait de défaire un appariement dont une ligne figure dans
-- n'importe quel rapprochement. Un rapprochement en cours n'est qu'un travail : ses coches se changent à volonté. Le
-- garde ne vaut donc que pour un rapprochement complété (la preuve du relevé); pour défaire l'appariement d'une ligne
-- d'un rapprochement complété, on rouvre d'abord le dernier rapprochement du compte.

CREATE OR REPLACE FUNCTION bank_match_reconciled_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1
               FROM reconciled_line rl
               JOIN bank_reconciliation r ON r.company_id = rl.company_id AND r.id = rl.reconciliation_id
              WHERE rl.company_id = OLD.company_id AND rl.journal_line_id = OLD.journal_line_id AND r.status = 'COMPLETED') THEN
    RAISE EXCEPTION 'a match cannot be removed while a completed reconciliation counts its line' USING ERRCODE = 'AL010';
  END IF;
  RETURN OLD;
END $$;
