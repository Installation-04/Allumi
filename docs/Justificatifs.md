# Justificatifs et pièces jointes

Les fiches de factures fournisseurs, crédits fournisseurs et dépenses payées proposent un bloc **Justificatifs**, sur les brouillons comme sur les pièces validées ou annulées. Ce premier lot couvre les documents d’achats; les factures clients et autres cibles seront ajoutées ultérieurement.

## Ajouter et consulter

Choisissez un PDF, PNG ou JPEG puis **Ajouter le justificatif**. Chaque fichier doit être non vide, mesurer au plus 4 Mo et avoir une extension correspondant à la signature détectée. La limite est de 20 fichiers par pièce. Un HTML ou SVG déguisé est refusé; le type déclaré par le navigateur ne suffit pas à autoriser le dépôt.

Les membres disposant du droit d’écriture **Comptabilité** peuvent ajouter des fichiers. Le droit de lecture permet de consulter la liste et de télécharger. Chaque téléchargement revérifie l’entreprise, les permissions et le lien à la pièce; il n’existe pas de lien public ni de partage anonyme.

Le téléchargement se fait comme fichier joint, avec cache désactivé et protection contre l’interprétation d’un autre type de contenu. La taille et l’empreinte SHA256 sont vérifiées; un fichier absent ou altéré n’est pas envoyé. Les justificatifs ne changent ni les montants ni l’écriture comptable.

![Justificatif sur ordinateur](https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/justificatif-depense-desktop.png)

![Justificatif sur téléphone](https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/justificatif-depense-mobile.png)

## Retirer et conserver

Sur un brouillon, **Retirer du brouillon** demande une confirmation. Le lien est retiré et, s’il n’en reste aucun, le justificatif est masqué par suppression logique. Le brouillon peut ensuite être supprimé. Le fichier physique reste conservé dans le stockage privé et les sauvegardes; aucune purge automatique n’est proposée dans ce lot.

Sur une pièce comptabilisée ou annulée, les justificatifs restent conservés pour l’historique et ne peuvent pas être détachés. Un complément peut être ajouté, dans la limite de 20 fichiers. Les créations et retraits de métadonnées restent dans la piste d’audit.

## Stockage et sauvegardes

Docker utilise `/app/storage/attachments` dans le volume `app_storage`. Les noms de stockage sont aléatoires et séparés par entreprise; le nom reçu n’est jamais utilisé comme chemin. Les fichiers ne se trouvent pas dans le répertoire web public.

Les scripts existants de [[Sauvegardes]] et de restauration incluent ce volume. **Conservez la base et le stockage ensemble** : restaurer uniquement la base ne restaure pas les fichiers. Testez régulièrement une restauration complète.

En développement hors Docker, `ATTACHMENTS_DIR` permet un répertoire privé accessible en écriture au processus, par exemple `/tmp/allumi-attachments`. Cette valeur est fixée à `/app/storage/attachments` par le compose de production. Les sauvegardes Docker couvrent ce chemin standard; un autre stockage local doit être sauvegardé séparément.

La vérification du format et de l’intégrité n’est pas un antivirus. N’ouvrez que des documents provenant de sources de confiance. Les métadonnées et le disque ne forment pas une transaction unique : après un résultat de commit incertain, un fichier privé orphelin peut être conservé pour éviter une perte. Une purge administrative automatique reste à venir.

Voir [[Factures-fournisseurs]], [[Depenses-payees]] et [[Utilisateurs-et-permissions]].
