# AGENTS.md — Règles permanentes pour OpenCode (projet Bulletins Scolaires)

Lis ce fichier au début de chaque session. Lis aussi `docs/CAHIER_DES_CHARGES.md` et `docs/DECISIONS.md`.

## Mission
Construire « Bulletins Scolaires » : logiciel multi-établissements de gestion des notes et bulletins (6e → Terminale, 2 semestres, Sénégal). Priorités : 1) fiabilité des calculs, 2) sécurité et isolation des données, 3) continuité S1 → S2, 4) qualité de l'interface.

## Méthode
- Travaille UNE phase à la fois (`prompts/phase-N.md`). Ne commence pas la suivante sans validation de l'utilisateur.
- Avant de coder : analyse le dossier existant, annonce un plan court.
- Projet exécutable à la fin de chaque phase. Lance les tests de la phase et corrige tout avant de conclure.
- Ne supprime aucun travail existant sans justification.
- Fin de phase : rapport court = ce qui marche / ce qui est testé / ce qui reste.
- Ne prétends jamais qu'une fonction marche si elle n'a pas été testée.

## Stack (figée, voir DECISIONS.md)
Frontend : Tauri 2 + React + TypeScript + Vite + Tailwind + shadcn/ui + Recharts + Lucide + React Hook Form + Zod.
Backend : Node.js + Express.js + TypeScript + Prisma (ORM).
BDD : PostgreSQL. Docker Compose pour l'installation. Versions épinglées (`package-lock.json`).
Auth : sessions cookie httpOnly + jeton CSRF lié à la session, mots de passe scrypt, limitation des tentatives.
Tests : Vitest + Supertest (backend), Vitest + React Testing Library (frontend), Playwright.

## Règles de code
- Notes et moyennes : `Decimal` (Prisma / decimal.js), jamais `number` flottant.
- Tout calcul (moyennes, rangs, annuel) est dans le backend, dans un module dédié, testé.
- Toute table métier a `schoolId`. Toute requête passe par une couche d'accès (repositories / extension Prisma) qui filtre sur l'établissement de l'utilisateur.
- Permissions vérifiées côté serveur (PDF, exports, statistiques inclus).
- Suppression logique (`deletedAt`) pour élèves, classes, notes, bulletins.
- Opérations sensibles → `AuditLog`.
- Secrets dans `.env` (fournir `.env.example`), jamais dans Git.
- Composants réutilisables, code lisible, pas de bouton sans action.
- Aucune donnée fictive dans les données réelles. Les données de démo vivent dans le script `npm run seed:demo` (local uniquement) et sont marquées « FICTIF ».
- Règle scolaire incertaine → rendre configurable + noter « à valider par l'établissement » dans `docs/A_VALIDER.md`.
- Ne jamais inventer : numéro d'agrément, signature, mention ministérielle.
- Texte de l'interface en français.

## Identité visuelle
Bleu marine #0B2D4F, vert émeraude #0B9B67, blanc #FFFFFF, or #E5B544, gris clair.
Logo : voir `docs/assets/`. Pas de photo de personne dans le logo.
