# Décisions techniques (tranchées)

| Sujet | Décision |
|---|---|
| Architecture | Application de bureau Tauri (React + TypeScript) + API REST Express.js + PostgreSQL. Le frontend consomme l'API ; aucune logique métier dans le frontend. |
| Frontend | Tauri 2 + React + TypeScript + Vite + Tailwind + shadcn/ui + Recharts + Lucide + React Hook Form + Zod. |
| Backend | Node.js + Express.js + TypeScript. Validation Zod. API REST versionnée sous `/api/v1`. |
| ORM / BDD | Prisma + PostgreSQL. Migrations versionnées (`prisma migrate`). Pas de SQL brut sans justification. |
| Multi-établissement | Base unique, `schoolId` sur chaque table métier, couche d'accès (repositories / extension Prisma) exigeant `schoolId` et filtrant automatiquement. Tests d'isolation obligatoires. |
| Authentification | Sessions Express (cookie httpOnly, SameSite=Lax, Secure en production) stockées en base via `connect-pg-simple`. Jeton CSRF lié à la session (`X-CSRF-Token`). Pas de JWT. Limitation des tentatives (`express-rate-limit`) et verrouillage temporaire après 5 échecs. Mots de passe hachés avec scrypt (`node:crypto`, sel aléatoire). CORS restreint aux origines Tauri/dev avec credentials. En développement, le frontend passe par le proxy Vite `/api` pour rester en même origine. |
| Rôles | PLATFORM_ADMIN, SCHOOL_ADMIN (ajouté : nécessaire pour gérer l'établissement), SURVEILLANT_GENERAL, ASSISTANT. Permissions fines configurables par établissement. |
| Accès admin plateforme aux notes | Interdit par défaut. Accès temporaire (durée limitée) accordé par le SCHOOL_ADMIN, motif obligatoire, entièrement journalisé. |
| Notes | `Grade.enrollmentId` (pas `studentId`). `score` Decimal(5,2) nullable. `status` : SAISIE, ABSENT, ANNULEE, NON_SAISIE. Un zéro n'est valide que si status=SAISIE. Contrainte unique (assessment, enrollment). |
| Présences | Un événement daté `AttendanceRecord` est rattaché à une inscription et à un semestre ; absence/retard, justification et durée du retard (minutes) sont explicites. Les totaux sont figés dans les snapshots semestriels et annuels ; une donnée non saisie n'est jamais transformée en absence. |
| Appréciations | `Appreciation` conserve une appréciation disciplinaire par élève, semestre et discipline ; elle est incluse au snapshot du bulletin. Les textes globaux du bulletin/bilan restent modifiables avant publication et sont conservés dans leur snapshot. |
| Décision du conseil | `CouncilDecision` est versionnée. Une version `BROUILLON` n'est jamais présentée comme officielle ; seule une validation par `SCHOOL_ADMIN` l'inclut dans les bilans annuels brouillon. Une décision publiée dans un bilan figé ne change pas rétroactivement. |
| Archives et historique | Les archives sont consultables par année clôturée et regroupent les versions de bulletins/bilans et les données de vie scolaire. Les créations, modifications, suppressions logiques et validations alimentent `AuditLog`. |
| Note manquante | Jamais convertie en 0 sans règle explicite configurée. |
| Décimales | Type `Decimal` Prisma + `decimal.js` pour tous les calculs. Jamais `number` flottant pour notes et moyennes. |
| Moyenne matière | Par défaut : (moy. devoirs + moy. compositions) / 2. Formule configurable par établissement. |
| Moyenne générale | Σ(moy_i × coef_i) / Σ(coef_i), uniquement sur les matières avec moyenne valide et comptabilisées. |
| Moyenne annuelle | Par défaut (S1 + S2) / 2, configurable (pondération, formule personnalisée). À valider par l'établissement. |
| Rangs | Ex æquo = même rang, rang suivant sauté (1, 2, 2, 4). Élèves sans moyenne calculable : non classés. Mode configurable. |
| Arrondi | Calcul interne en précision complète ; arrondi à l'affichage seulement (2 décimales par défaut, configurable). |
| PDF | PDFKit (portable sous Windows) pour les bulletins A4. Impression par lot = un PDF multi-pages. |
| Versionnage bulletin | `ReportCard.version` + `calculation_snapshot` (JSON : coefficients, formules, notes utilisées). Bulletin publié = figé ; correction = nouvelle version + trace. |
| Import CSV | Colonnes : matricule, nom, prenoms, date_naissance (AAAA-MM-JJ), lieu_naissance, sexe, parent_nom, parent_tel, classe. Encodage UTF-8. Prévisualisation + rapport d'erreurs avant import. |
| Données personnelles | Minimisation ; conformité à la loi sénégalaise n° 2008-12 (CDP) à vérifier avec l'établissement ; politique de conservation configurable. |
| OpenAPI | swagger-jsdoc + swagger-ui-express, Swagger UI sur `/api/docs/`. |
| Tests | Vitest + Supertest (backend), Vitest + React Testing Library (frontend), Playwright (parcours). Les tests backend utilisent une base PostgreSQL dédiée via `TEST_DATABASE_URL` (jamais la base de développement). |
| Données de démo | Script `npm run seed:demo` (Prisma seed), local uniquement, données marquées « FICTIF ». |
| Langue | Français uniquement (v1). |
