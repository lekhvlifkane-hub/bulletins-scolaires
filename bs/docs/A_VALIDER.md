# Règles à faire valider par l'établissement
(OpenCode complète ce fichier au fil du développement.)

- [ ] Formule de la moyenne par matière — *implémentation phase 4 (par défaut, configurable en base)* : moyenne des groupes `DEVOIR` et `COMPOSITION` pondérés par les poids de l'établissement (`regleCalculMatiere = POIDS_GROUPES`) ; un groupe sans note valable est exclu et la pondération se renormalise ; `AUTRE` a un poids nul par défaut.
- [ ] Formule de la moyenne annuelle — *implémentation phase 4* : moyenne des deux semestres pondérée par `poidsSemestres` (1/1 par défaut) ; si un semestre manque, l'annuelle est `null` (règle `annuelSiSemestreManquant`) et le motif est affiché, jamais une valeur inventée.
- [ ] Mode de classement (ex æquo) et arrondi — *implémentation phase 4* : rangs standard `1, 2, 2, 4` (`rangMode`, mode `dense` disponible) ; arrondi uniquement à l'affichage (`arrondiDecimales`, `half-up`), la valeur exacte reste visible en infobulle.
- ⚠️ Ces règles (moyenne par matière, pondérations, barème, absences, rangs, arrondi, poids des semestres, moyenne annuelle) se règlent depuis l'écran **Paramètres établissement → Règles de calcul** par un administrateur d'établissement. Les valeurs par défaut restent celles décrites ci-dessus tant que l'établissement ne les a pas modifiées.
- [ ] Mentions (seuils : Tableau d'honneur, Félicitations, Encouragements, Avertissement...)
- [ ] Règles de décision du conseil de classe
- [ ] En-tête administratif du bulletin (devise, ministère, inspection)
- [ ] Numéro d'agrément, cachet, signataires autorisés
- [ ] Barème et nombre de devoirs / compositions
- [ ] Effet d'une absence sur la moyenne — *implémentation phase 4* : une absence (`ABSENT`) ou une note annulée (`ANNULEE`) est **exclue** du calcul, jamais remplacée par 0 (règle `absencesComptentZero` = false par défaut, un 0 ne vaut pas une absence). À confirmer par l'établissement.
- [ ] Politique de conservation des données
- [ ] **Envoi des e-mails** : l'application écrit chaque message (invitation, réinitialisation de mot de passe) dans une file durable avant de l'envoyer ; un échec SMTP est relancé jusqu'à cinq fois avant abandon. Le fournisseur (`SMTP_HOST`, `SMTP_FROM`, `APP_BASE_URL`) reste à définir par l'établissement : **l'API refuse de démarrer en production sans lui**. Tant qu'il n'est pas configuré, rien n'est envoyé et le lien est seulement journalisé — les invitations et réinitialisations restent donc à transmettre à la main.

## Phase 5 — bulletins, comparaison et bilan annuel

- [ ] Mentions et décision du conseil **ne sont pas calculées automatiquement** : l'établissement les saisit sur le bulletin (brouillon) avant publication. Les seuils (« Tableau d'honneur », « Félicitations », « Encouragements », « Avertissement ») restent à nous communiquer si vous voulez un remplissage automatique.
- [ ] Moyenne annuelle **par matière** : implémentation actuelle = pondération des moyennes S1 et S2 par `poidsSemestres` (1/1 par défaut), avec `annuelSiSemestreManquant` pour conduire la règle quand un semestre n'a pas de moyenne. À confirmer : certaines pratiques font la moyenne annuelle par matière sur l'ensemble des notes de l'année.
- [ ] **Mise en page du PDF** : `docs/assets/` ne contenait aucun exemple de bulletin (un simple `LISEZ-MOI` placeholder). Le A4 produit est donc une **maquette** (en-tête établissement, tableau des matières, synthèse, rang, mention, pied de page) validable visuellement, pas un document homologué. Aucun numéro d'agrément, aucune mention ministérielle, aucune signature n'est inventé : ces champs restent vides tant que l'établissement ne les fournit pas.
- [ ] Appréciations par matière : saisie libre sur le bulletin avant publication, conservées lors d'une régénération. Le format attendu par le conseil de classe (longueur, qui les rédige) reste à préciser.
- [ ] Impression par lot : plafond fixé à **60 bulletins** (ou 60 bilans) par PDF, pour tenir la mémoire du serveur. À ajuster si l'établissement imprime des classes plus nombreuses en une fois.

## Phase 6 — vie scolaire, appréciations et conseil

- [ ] Une absence est enregistrée par événement et distinguée d'un retard ; la justification est saisie par l'établissement. La durée des retards est facultative et exprimée en minutes.
- [ ] Les absences justifiées, non justifiées et retards sont agrégés par semestre puis sur les deux semestres du bilan annuel. Aucune présence non saisie n'est interprétée comme une absence.
- [ ] Une décision du conseil est un brouillon jusqu'à validation par un administrateur d'établissement. Aucune décision non validée n'est ajoutée au bilan PDF.
- [ ] Les archives exposent les versions et historiques d'années clôturées. Leur durée de conservation reste à définir par l'établissement.
- [ ] Les corrections d'absences et appréciations après clôture ne sont pas prévues par l'interface actuelle ; elles nécessitent une procédure tracée à définir avant mise en production.
