# Règles à faire valider par l'établissement
(OpenCode complète ce fichier au fil du développement.)

- [ ] Formule de la moyenne par matière — *implémentation phase 4 (par défaut, configurable en base)* : moyenne des groupes `DEVOIR` et `COMPOSITION` pondérés par les poids de l'établissement (`regleCalculMatiere = POIDS_GROUPES`) ; un groupe sans note valable est exclu et la pondération se renormalise ; `AUTRE` a un poids nul par défaut.
- [ ] Formule de la moyenne annuelle — *implémentation phase 4* : moyenne des deux semestres pondérée par `poidsSemestres` (1/1 par défaut) ; si un semestre manque, l'annuelle est `null` (règle `annuelSiSemestreManquant`) et le motif est affiché, jamais une valeur inventée.
- [ ] Mode de classement (ex æquo) et arrondi — *implémentation phase 4* : rangs standard `1, 2, 2, 4` (`rangMode`, mode `dense` disponible) ; arrondi uniquement à l'affichage (`arrondiDecimales`, `half-up`), la valeur exacte reste visible en infobulle.
- ⚠️ Ces règles (moyenne par matière, pondérations, barème, absences, rangs, arrondi, poids des semestres, moyenne annuelle) se règlent depuis l'écran **Paramètres établissement → Règles de calcul** par un administrateur d'établissement. Les valeurs par défaut restent celles décrites ci-dessus tant que l'établissement ne les a pas modifiées.
- [ ] Mentions, appréciations et décisions proposées : seuils et textes initiaux fournis à titre de base modifiable dans **Paramètres établissement → Appréciations automatiques** ; les libellés, seuils et modèles doivent être validés par chaque établissement. Une proposition automatique n'est jamais publiée comme décision officielle du conseil.
- [ ] En-tête administratif du bulletin officiel : devise, ministère et IEF sont affichés, l'IEF et les coordonnées de l'établissement doivent être confirmés ; drapeau et logo du Ministère sont chargeables (un placeholder neutre est utilisé s'ils ne sont pas fournis).
- [ ] Numéro d'agrément, cachet, signataires autorisés : volontairement laissés vides, aucun libellé officiel n'est inventé.
- [ ] Barème et nombre de devoirs / compositions : les modèles par niveau proposent les disciplines et coefficients ; la structure `Devoir 1`, `Devoir 2`, `Composition` reste figée et doit être confirmée par l'établissement.
- [ ] Effet d'une absence sur la moyenne — *implémentation phase 4* : une absence (`ABSENT`) ou une note annulée (`ANNULEE`) est **exclue** du calcul, jamais remplacée par 0 (règle `absencesComptentZero` = false par défaut, un 0 ne vaut pas une absence). À confirmer par l'établissement.
- [ ] Politique de conservation des données
- [x] ~~**Envoi des e-mails**~~ — **résolu le 2026-11-09 : le sous-système e-mail a été supprimé.** L'application n'envoie plus de messages : les invitations d'utilisateurs affichent le mot de passe temporaire dans l'interface (à transmettre à la main), les notifications d'inscription d'établissement n'existent plus et la récupération « mot de passe oublié » n'est plus disponible (un nouvel utilisateur se crée via l'interface, un mot de passe perdu se règle par récréation/modification du compte par l'administrateur). Aucune variable SMTP n'est requise ; le fichier `docs/DECISIONS.md` consigne la décision.

## Phase 5 — bulletins, comparaison et bilan annuel

- [x] Mention et appréciation générale : propositions générées à partir des seuils/modèles configurés, modifiables avant publication et conservées lors d'une régénération si un utilisateur les a remplacées. Les décisions calculées restent indicatives et ne remplacent jamais la validation dédiée du conseil de classe.
- [ ] Moyenne annuelle **par matière** : implémentation actuelle = pondération des moyennes S1 et S2 par `poidsSemestres` (1/1 par défaut), avec `annuelSiSemestreManquant` pour conduire la règle quand un semestre n'a pas de moyenne. À confirmer : certaines pratiques font la moyenne annuelle par matière sur l'ensemble des notes de l'année.
- [x] **Mise en page du PDF** : le modèle simple et le modèle officiel Sénégal sont rendus en A4. Le modèle officiel reprend l'en-tête administratif, l'identité avec IEN, le tableau des disciplines par groupes, les totaux, les synthèses S1/S2, la moyenne annuelle et les cases de décision avec deux QR codes. Les tests de journal vérifient le texte réellement dessiné et l'absence de débordement ; une relecture visuelle sur imprimante reste nécessaire avant homologation.
- [x] Appréciations par matière : proposées selon la moyenne, puis modifiables par l'établissement ; les textes manuels sont distingués des textes automatiques et conservés lors d'une régénération.
- [ ] Impression par lot : plafond fixé à **60 bulletins** (ou 60 bilans) par PDF, pour tenir la mémoire du serveur. À ajuster si l'établissement imprime des classes plus nombreuses en une fois.

## Phase 6 — vie scolaire, appréciations et conseil

- [ ] Une absence est enregistrée par événement et distinguée d'un retard ; la justification est saisie par l'établissement. La durée des retards est facultative et exprimée en minutes.
- [ ] Les absences justifiées, non justifiées et retards sont agrégés par semestre puis sur les deux semestres du bilan annuel. Aucune présence non saisie n'est interprétée comme une absence.
- [ ] Une décision du conseil est un brouillon jusqu'à validation par un administrateur d'établissement. Aucune décision non validée n'est ajoutée au bilan PDF.
- [ ] Les archives exposent les versions et historiques d'années clôturées. Leur durée de conservation reste à définir par l'établissement.
- [x] ~~**Corrections après clôture**~~ — **résolu le 2026-11-16 : toute écriture de vie scolaire (absence, retard, appréciation, décision du conseil) est refusée (`409`) sur une année clôturée.** Une éventuelle procédure de correction tracée reste à définir avant mise en production si l'établissement en a besoin.

## Phase 7 — modèles de matières et bulletin officiel

- [ ] Coefficients des modèles 6e (17), 5e (19), 4e (24) et 3e (24), ainsi que les options de 4e, doivent être validés par l'établissement.
- [ ] L'identifiant IEN est stocké et affiché ; le format exact attendu par l'administration reste à confirmer.
- [ ] Les libellés des cases du bulletin officiel (travail, discipline, progrès, initiative, absentéisme, ponctualité, décision) et le seuil de passage proposé (10 par défaut) doivent être validés.
- [ ] Les QR codes pointent vers les routes départementales `INFO:ELEVE:<matricule>` et `BULLETIN:<inscription>:<semestre>` ; la destination finale côté établissement reste à confirmer.
- [x] **Audit automatique de la maquette officielle (2026-11-21)** : S1 et S2 générés en une page A4, avec 0 débordement, 0 chevauchement de texte, 0 tableau rejeté, 0 caractère non encodé, 2 QR codes et tous les libellés obligatoires présents. Rapport détaillé : `%TEMP%\opencode\audit-pdf.json`. La relecture sur imprimante par l'établissement reste requise avant homologation.

## Fiche d'homologation — bulletin officiel (à imprimer)

À compléter après impression réelle des PDF `bulletin-officiel-s1.pdf` et `bulletin-officiel-s2.pdf`, en présence du responsable pédagogique.

### Contrôle technique (déjà vérifié automatiquement)

- [x] A4, une page par semestre, aucun débordement ni chevauchement.
- [x] Aucun tableau rejeté, aucun caractère non encodé, deux QR codes présents.
- [x] Libellés obligatoires présents (République, Ministère, IEF, IEN, semestre, année, totaux, décision).

### Contrôle métier à valider par l'établissement

- [ ] En-tête : devise, ministère, IEF, nom/adresse de l'établissement, année scolaire, IEN.
- [ ] Modèles et coefficients : 6e 17, 5e 19, 4e 24, 3e 24 ; options de 4e et groupes Français/SVT/Arabe.
- [ ] Tableau des matières : Devoirs, Composition, Moyenne, Moy×Coef ; ABS/ANN conservés, aucune moyenne inventée.
- [ ] Rangs avec ex æquo, moyenne de classe et synthèse S1/S2 corrects.
- [ ] Absences justifiées/non justifiées et retards conformes aux registres.
- [ ] Appréciations : 9 bandes officielles ; décision proposée avec seuil par défaut 10.
- [ ] Cases du conseil et observations laissées libres ; aucune signature ni agrément inventé.
- [ ] QR codes : `INFO:ELEVE:<matricule>` et `BULLETIN:<inscription>:<semestre>` lisibles et destination confirmée.
- [ ] Impression recto A4 : lisibilité, marges, aucun texte coupé.

Nom et fonction : ..................................................

Date : ..............

Conclusion : [ ] homologué  [ ] homologué avec réserves  [ ] non homologué

Réserves éventuelles : ..............................................................................
