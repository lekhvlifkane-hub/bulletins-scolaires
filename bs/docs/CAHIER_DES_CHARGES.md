# Cahier des charges — Bulletins Scolaires (v1.1)

**Produit** : Bulletins Scolaires — « LA GESTION SCOLAIRE, PLUS SIMPLE »
**Type** : application de bureau (Tauri) multi-établissements adossée à une API web, établissements privés du Sénégal, 6e → Terminale, 2 semestres, français.
**Références** : `AGENTS.md` (règles), `DECISIONS.md` (choix techniques), `A_VALIDER.md`, `assets/` (logo, exemples de bulletins).

## 1. Objectif
Centraliser élèves, classes, séries, disciplines, coefficients, notes, moyennes, rangs, bulletins PDF (S1, S2), bilan annuel, absences, appréciations et décisions du conseil de classe. Tout doit être réellement fonctionnel (pas de maquette).

## 2. Périmètre par version
**MVP (priorité)** : connexion et rôles, établissement, année scolaire + semestres, niveaux/séries/classes, élèves + inscriptions, disciplines + coefficients, évaluations, saisie des notes, moyennes + rangs, bulletin PDF S1 et S2 (lien S1→S2), bilan annuel, tableau de bord de base, journal d'audit.
**V1.1** : absences/retards détaillés, appréciations, décisions du conseil, impression par lot, import/export CSV, archives, comparaison des semestres.
**V1.2** : graphiques avancés, sauvegardes automatiques configurables, paramètres de sécurité avancés.

## 3. Établissements
Chaque établissement a son espace isolé : nom officiel, logo, adresse, ville, téléphone, e-mail, n° d'agrément, année active, cachet, signatures, classes, élèves, disciplines, coefficients, comptes, bulletins, archives.
Page « Paramètres de l'établissement » : infos administratives, logo, cachet, signatures, règles de calcul, arrondi, modèles de bulletin, mentions, règles de classement, publication.
Ne jamais inventer de n° d'agrément ni de signature.

## 4. Rôles et sécurité
- **Administrateur plateforme** : crée/désactive les établissements, gère les admins d'établissement, état technique. Pas d'accès libre aux notes (voir DECISIONS.md).
- **Administrateur d'établissement** : gère comptes, paramètres, droits.
- **Surveillant général** : scolarité, classes, élèves, résultats, vérification, validation/publication (selon droits), absences, décisions, PDF, statistiques.
- **Assistant** : saisie administrative, élèves, consultation, préparation de documents.
Les droits de modification des notes, validation et publication sont configurables.
Sécurité : mots de passe hachés, réinitialisation sécurisée, expiration de session, limitation des tentatives, permissions serveur, CSRF, journalisation des opérations sensibles. Aucune élévation de droits par manipulation de requête.

## 5. Organisation pédagogique
- **Année scolaire** : début, fin, statut (préparation / active / clôturée), 2 semestres. Une année clôturée n'est modifiable que par correction autorisée et tracée.
- **Niveaux** : 6e, 5e, 4e, 3e, Seconde, Première, Terminale.
- **Séries** : configurables par niveau et établissement (valeurs initiales proposées : L1, L2, S1, S2…), jamais figées.
- **Classes** : nom, niveau, série, année, effectif calculé, disciplines, élèves, historique, archivage.

## 6. Élèves
Fiche : matricule unique, nom, prénoms, date et lieu de naissance, sexe (optionnel), adresse, parent/tuteur, téléphone, date d'inscription, statut (actif, transféré, sorti, archivé). Photo facultative. Minimisation des données.
Opérations : ajouter, modifier, rechercher, filtrer, historique, transférer de classe, préparer la réinscription, archiver, import CSV validé, export.
Anti-doublons : matricule unique + alerte sur fiches potentiellement identiques.
L'historique d'inscriptions (Enrollment) est conservé ; un changement de classe ou d'année n'efface jamais les anciens bulletins.

## 7. Disciplines et coefficients
Discipline : nom, code, niveau, série, coefficient, statut, règle de calcul, ordre d'affichage. Liste purement illustrative (Français, Maths, Anglais, HG, SVT, PC, Philo, Espagnol, Arabe, Économie, Informatique, EPS, Éducation civique…). Affectation à plusieurs classes avec coefficients différents ; la version des coefficients utilisée par un bulletin validé est conservée.

## 8. Semestres et continuité
- Chaque semestre : dates, période de saisie, statut, date de publication, historique des validations (dates configurables).
- Le bulletin S2 est lié au bulletin S1 du même élève (même année) : identité, matricule, établissement, année, classe/série, paramètres, historique S1 réutilisés automatiquement. Aucune ressaisie de fiche.
- Notes S1 et S2 totalement indépendantes. Correction d'une note publiée : procédure autorisée, trace, régénération du bulletin si nécessaire.
- Passage au S2 : ouvrir le semestre, retrouver élèves/classes/disciplines, saisir, calculer, générer, consulter S1, préparer le bilan. Gérer les changements de classe entre semestres.
- **Bilan annuel** : résultats S1 et S2, moyenne annuelle (formule de l'établissement, voir DECISIONS.md), rang annuel, absences/retards annuels, appréciations, décision du conseil. Distinguer résultats calculables et données manquantes.

## 9. Saisie des notes
- Types d'évaluation configurables (devoir, composition, interrogation, autre) ; nombre configurable (ex. 2 devoirs + 2 compositions).
- Écran : choisir année, semestre, classe, discipline, évaluation ; élèves en lignes, notes en colonnes ; saisie clavier rapide, déplacement entre cellules, sauvegarde explicite avec indicateur, erreurs visibles, filtres, recherche, anti-doublon d'évaluation. Aucune perte de données en cas d'erreur.
- Barème configurable (/20 par défaut), décimales selon précision. Distinguer : absence, non saisie, annulée, zéro.
- États : brouillon → en cours de saisie → à vérifier → validé → publié → corrigé après publication (historique). Un bulletin publié est figé ; les corrections sont versionnées.

## 10. Moteur de calcul (backend, testé)
- Moyenne matière : formule configurable (défaut : (moy. devoirs + moy. compositions) / 2).
- Points pondérés : P_i = m_i × c_i.
- Moyenne générale : M = Σ(m_i × c_i) / Σ(c_i), sur matières valides et comptabilisées ; une matière sans résultat valide n'entre pas dans le dénominateur ; matières exclues configurables.
- Rangs : règle configurable (ex æquo, sans moyenne, résultats incomplets).
- Arrondi : configurable ; précision interne complète.
- **Tests obligatoires** : moyenne simple, pondérée, coefficient nul/invalide, note manquante, absence, matière non comptabilisée, décimales, égalités de rang, changement de coefficient, S1 et S2, calcul annuel, classe incomplète.

## 11. Bulletin PDF (A4)
Inspiré des bulletins sénégalais type PLANÈTE Élève (exemples dans `docs/assets/`). Configurable et validé par l'établissement avant usage officiel ; une maquette n'est pas un document homologué.
- **En-tête** (textes configurables, aucune mention ministérielle figée) : République du Sénégal, devise si retenue, autorité compétente (intitulé vérifié), logo et nom de l'établissement, agrément, adresse, téléphone, année scolaire, « Bulletin de notes », « 1er / 2e semestre ».
- **Identité** : nom, prénoms, matricule, date/lieu de naissance (si requis), niveau, classe, série, effectif, rang.
- **Tableau** : N° | Disciplines | Devoirs | Compositions | Moy./20 | Coef. | Pts pond. | Rang | Appréciations (sous-colonnes devoirs/compositions configurables).
- **Synthèse** : total coefficients, total points, moyenne générale, rang, effectif, moyenne de classe, mention. Non calculable = indiqué clairement, jamais de valeur fictive.
- **Absences/retards** : justifiées, non justifiées, retards, total.
- **Appréciation globale** : conseil de classe, observations, décision (jamais affichée comme officielle sans validation), signataires, cachet.
- Lisible à l'impression, sans débordement ni texte coupé ; téléchargement PDF ; impression individuelle ou par lot. Identité de l'établissement privilégiée sur le bulletin.

## 12. Tableau de bord
Indicateurs réels (élèves, classes, disciplines, effectifs par niveau, bulletins par état, avancement de la saisie par classe, moyennes par classe, absences). Graphiques Recharts alimentés uniquement par la base. Actions rapides : ajouter élève, créer classe, saisir notes, calculer, générer bulletins, ouvrir S2, bilan annuel.

## 13. Pages
Connexion, mot de passe oublié, tableau de bord, établissements, paramètres établissement, utilisateurs, années, semestres, niveaux/séries, classes, liste élèves, création/détail/historique élève, disciplines, coefficients, types d'évaluation, saisie, vérification, calcul, classement, bulletins S1, bulletins S2, comparaison, bilan annuel, absences, appréciations, décisions, prévisualisation, export PDF, impression par lot, archives, historique des modifications, sécurité, profil, erreurs/404. Toutes reliées, aucune action factice.

## 14. Design et UX
Minimalisme premium, couleurs institutionnelles, cartes espacées, typographie lisible, animations discrètes. Barre latérale (Tableau de bord, Scolarité, Élèves, Classes, Disciplines, Notes, Bulletins, Semestres, Bilan annuel, Absences, Rapports, Paramètres) adaptée au rôle, affichant utilisateur et établissement. Formulaires : libellés clairs, champs obligatoires, validation, messages d'erreur, retour après sauvegarde, confirmation avant action irréversible. Responsive (grand écran → mobile, saisie de notes praticable sur mobile).

## 15. Modèle de données
School, User, AcademicYear, Semester, Level, Series, Classroom, Student, Enrollment, Subject, ClassroomSubject (coefficient + versions effective_from/to), Assessment, Grade (enrollment_id, Decimal, status enum, unique(assessment, enrollment)), ReportCard (version, calculation_snapshot, statuts), AnnualSummary, AttendanceRecord, Appreciation, CouncilDecision, AuditLog, TemporaryAccessGrant (accès admin plateforme tracé). `school_id` sur toutes les tables métier ; ne pas stocker inutilement des valeurs recalculables ; contraintes et index sur les recherches fréquentes.
**Isolation** : toute requête limitée à l'établissement (PDF, exports, détails, stats inclus) ; tests prouvant qu'un établissement ne voit jamais les données d'un autre.

## 16. API
REST documentée (OpenAPI/Swagger) : auth, schools, users, academic-years, semesters, levels, series, classrooms, students, enrollments, subjects, assessments, grades, calculations, report-cards, annual-summaries, attendance, appreciations, council-decisions, audit-logs, dashboard. Pour chaque endpoint : permissions, paramètres, réponse, erreurs, validations.

## 17. Sécurité et données
Voir §4 + : injection SQL (ORM), validation stricte, gestion sécurisée des fichiers, accès restreints aux PDF, sauvegardes protégées, secrets en variables d'environnement, `.env.example`, config dev/prod distinctes, politique de conservation compatible avec la loi sénégalaise 2008-12 (à valider).

## 18. Sauvegardes
Sauvegarde BDD, procédure de restauration, vérification d'intégrité, documentation de reprise, journalisation des erreurs, messages clairs. Une sauvegarde n'est fiable qu'après test de restauration réussi.

## 19. Installation et déploiement
Dev sous Windows documenté pas à pas (Node.js LTS, Rust + WebView2 pour Tauri, Git, Docker Desktop, variables d'environnement, dépendances, BDD, migrations Prisma, compte administrateur initial, démarrage backend/frontend, accès à l'API). Prod : API Express + frontend Tauri compilé + PostgreSQL, HTTPS, fichiers téléversés, sauvegardes, logs, procédure de mise à jour, migrations contrôlées.

## 20. Validation
Scénario de bout en bout : créer établissement → comptes → année → classes → élève → inscription → disciplines/coefficients → évaluations → notes → moyennes → rangs → bulletin S1 → valider/publier → ouvrir S2 → retrouver l'élève → notes S2 → bulletin S2 → bilan annuel → PDF → impression → persistance après reconnexion → permissions par rôle → isolation entre établissements.
Qualité : erreurs de validation, notes manquantes, égalités de rang, doublons, changements de classe, corrections après publication, accès non autorisés, erreurs réseau, compatibilité PDF, restauration d'une sauvegarde.

## 21. Résultat attendu
Un logiciel professionnel, documenté, testé et évolutif. **Priorité absolue** : fiabilité des calculs, respect de la structure de bulletin de l'établissement, continuité S1/S2, sécurité des données, qualité de l'interface.
