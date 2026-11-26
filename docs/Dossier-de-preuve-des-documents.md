# Télécharger le dossier de preuve d’un document

Dans **Ventes → Contrats et liens clients**, ouvre un document publié, puis utilise **Dossier de preuve → Télécharger le dossier de preuve (JSON)**. Ce téléchargement complète l’impression/PDF de la fiche et le CSV de suivi décrit dans [[Export-et-nettoyage-des-contrats]] : il conserve le contenu publié et les informations de signature déclarées dans un format exploitable.

Le fichier se nomme `allumi-evidence-<référence-du-document>.json`. Le téléchargement fonctionne aussi pour un document non signé, expiré, révoqué ou dont la soumission/facture source a été annulée. Il ne réactive pas le lien et ne change pas l’état de la source. Un brouillon n’a pas de dossier de preuve publié.

## Contenu du fichier

Le format `allumi.client-document-evidence`, version `1`, conserve des clés anglaises stables dans les deux langues de l’interface :

| Champ | Contenu |
|---|---|
| `capturedAt` | Instantané commun de la lecture serveur, en UTC ISO 8601 |
| `publication` | Référence du document et de l’entreprise, type, titre, parties, courriel destinataire, langue, texte lisible, empreinte SHA-256 et contenu canonique |
| `events` | Publication, expiration, première ouverture, signature et révocation; dates absentes à `null` |
| `signature` | Nom, courriel et consentement déclarés, ou `null` si le document n’est pas signé |
| `limitations` | Limites explicites du contrôle et de la signature |

Les dates sont en UTC, à la milliseconde. Le contenu d’un contrat est le texte rendu lors de sa publication, pas le modèle brut ni le modèle actuel. Pour une soumission/facture, le contenu canonique contient la copie des champs publics figés lors de la publication; les montants ne sont pas recalculés. Le champ `publication.text` est une présentation lisible de ces données, dans la langue du document.

Le contenu et la preuve sont lus dans une seule requête. Le téléchargement n’enregistre pas une consultation client, ne crée aucun courriel, paiement, signature ou mouvement comptable et ne modifie pas la piste d’audit.

## Contrôle de l’empreinte

Avant le téléchargement, Allumi reconstruit le texte JSON PostgreSQL utilisé lors de la publication et compare son SHA-256 à l’empreinte conservée. En cas de différence, il refuse le téléchargement entier, sans fichier partiel. Contacte l’administrateur pour examiner la restauration et les données; le document publié ne doit pas être modifié pour contourner ce contrôle.

`publication.canonicalPayload` est ce texte exact, conservé comme une **chaîne de caractères**. `canonicalization` vaut `postgresql-jsonb-array-text-v1`; `canonicalFields` décrit les onze positions : référence, entreprise, type, titre, émetteur, client, destinataire, langue, tarif en cents, texte rendu et copie source. Ne réordonne pas les valeurs et ne réécris pas ce texte après analyse JSON : les espaces, échappements et représentations numériques font partie des octets contrôlés.

Exemple de contrôle local avec Python 3, sans transmettre le fichier :

```python
import hashlib
import json
import sys
from pathlib import Path

package = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
assert package["format"] == "allumi.client-document-evidence"
assert package["version"] == 1
publication = package["publication"]
assert publication["canonicalization"] == "postgresql-jsonb-array-text-v1"
actual = hashlib.sha256(publication["canonicalPayload"].encode("utf-8")).hexdigest()
assert actual == publication["sha256"], "Le contenu canonique ne correspond pas à l’empreinte"
print("Contenu canonique conforme à l’empreinte du fichier")
```

Enregistre ce code dans `verifier_preuve.py`, puis lance `python3 verifier_preuve.py allumi-evidence-REFERENCE.json`.

Ce contrôle porte **uniquement sur les octets UTF-8 de `canonicalPayload`**. Les événements, la signature déclarée, la date d’extraction, le texte de présentation et l’enveloppe du fichier ne sont pas scellés par cette empreinte. Le fichier n’est pas signé numériquement : une personne pouvant le modifier pourrait remplacer le contenu et son empreinte. Pour comparer à une référence de confiance, conserve l’original et utilise les données et sauvegardes de ton serveur.

Allumi ne vérifie pas l’identité ou le pouvoir du signataire et n’ajoute ni certificat qualifié ni horodatage externe. Le nom et le courriel restent déclarés par le porteur du lien. Voir [[Contrats-et-signatures]].

## Confidentialité et permissions

**Ventes en lecture** dans l’entreprise est nécessaire, y compris pour un rôle lecture seule. Sans accès au module, dans une autre entreprise ou sans session, le fichier n’est pas accessible. La commande n’est pas exposée sur le portail public.

Le fichier contient des **noms, courriels, conditions contractuelles et éventuellement des adresses et données fiscales publiques de la copie source**. Il doit être conservé et partagé comme un document confidentiel. Aucun lien privé, jeton, clé chiffrée, modèle brut, note interne, pièce jointe ou historique SMTP n’est repris. Ne le confonds pas avec le CSV de suivi, qui exclut le contenu et les détails de signature.

Le JSON est téléchargé sans cache; Allumi ne conserve pas une nouvelle copie du fichier sur le serveur. Le document et sa preuve restent couverts par les [[Sauvegardes]]. Le téléchargement n’est pas un export global de toute la piste d’audit.

## Références visuelles

![Dossier de preuve depuis une fiche signée](https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/contrats-preuve-desktop.png)

<img src="https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/contrats-preuve-mobile.png" alt="Dossier de preuve sur téléphone" width="412">

![Evidence package in English and dark theme](https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/contrats-preuve-en-dark-desktop.png)

<img src="https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/contrats-preuve-en-dark-mobile.png" alt="Evidence package on mobile in English" width="412">

Toutes les captures utilisent des données fictives.
