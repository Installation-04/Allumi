-- Un dépôt contient au moins un paiement.
--
-- bank_deposit_check ne s'exécute qu'à l'insertion d'un élément de dépôt : un dépôt sans aucun élément n'était
-- jamais comparé à son total, et sortait son montant des fonds non déposés sans déposer de paiement. Ce
-- déclencheur différé refuse un dépôt sans élément (la somme des éléments égale alors le total, par
-- bank_deposit_check).
CREATE FUNCTION bank_deposit_complete() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM bank_deposit_item WHERE company_id = NEW.company_id AND deposit_id = NEW.id) THEN
    RAISE EXCEPTION 'a deposit contains at least one payment' USING ERRCODE = 'AL010';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER bank_deposit_complete
  AFTER INSERT ON bank_deposit DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION bank_deposit_complete();

-- Comme toutes les fonctions du schéma : rien n'est appelable par PUBLIC.
REVOKE EXECUTE ON FUNCTION bank_deposit_complete() FROM PUBLIC;
