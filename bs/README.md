# Bulletins Scolaires

Application de bureau (Tauri) multi-établissements pour la gestion des notes et bulletins scolaires au Sénégal.

- **Frontend** : Tauri 2 + React + TypeScript + Vite + Tailwind + shadcn/ui
- **Backend** : Express + TypeScript + Prisma
- **Base** : PostgreSQL (Docker)

## Prérequis (Windows)

Le guide détaillé d'installation Windows, de sécurité de production, de mises à jour et de restauration est dans [docs/DEPLOIEMENT.md](./docs/DEPLOIEMENT.md).

| Outil | Version conseillée | Vérification |
|---|---|---|
| Node.js | 22 LTS ou plus | `node --version` |
| npm | fourni avec Node | `npm --version` |
| Git | dernière version | `git --version` |
| Docker Desktop | dernière version, WSL2 activé | `docker --version` |
| Rust (rustup) | stable | `rustc --version` |
| WebView2 | installé avec Windows 11 / Edge | — |

Docker Desktop nécessite WSL2 (`wsl --install`) ou le backend Hyper-V activé, puis un redémarrage.
Rust est obligatoire pour compiler Tauri. Installer via <https://rustup.rs> puis rouvrir le terminal.
Sur Windows, le compilateur MSVC (Visual Studio Build Tools, charge de travail « Développement Desktop en C++ ») est également requis.

## Installation pas à pas

### 1. Configuration

À la racine du projet :

```powershell
Copy-Item .env.example .env
```

Adapter `POSTGRES_PASSWORD` dans `.env` si besoin.

### Créer un administrateur plateforme

Une fois la base et le backend démarrés (ou avec `DATABASE_URL` configuré) :

```powershell
cd backend
npm run create-platform-admin -- --email admin@plateforme.sn --name "Administrateur Plateforme"
```

Sans `--password`, le script génère un secret aléatoire et l'affiche une seule fois.

### 2. Base de données et API (Docker)

```powershell
docker compose up --build
```

- API : <http://localhost:4000/api/health>
- Documentation OpenAPI : <http://localhost:4000/api/docs>

Les migrations Prisma sont appliquées automatiquement au démarrage du conteneur backend.

### 3. Backend en développement (hors Docker)

Laisser la base démarrée (`docker compose up db`), puis :

```powershell
cd backend
Copy-Item .env.example .env
npm install
npx prisma generate
npx prisma migrate deploy
npm run dev
```

### 4. Frontend

```powershell
cd frontend
npm install
npm run tauri dev
```

Pour tester dans un navigateur (sans Rust) :

```powershell
cd frontend
npm run dev
```

Le serveur Vite écoute sur <http://localhost:1420>. L'API doit autoriser cette origine via `CORS_ORIGINS`.

## Tableau de bord et vie scolaire

Le tableau de bord consomme `GET /api/dashboard` pour afficher les indicateurs réels de la base (élèves, inscriptions, classes, disciplines, évaluations, bulletins, absences et retards). Les agrégats d'un établissement sont filtrés côté serveur ; un administrateur plateforme ne reçoit que des compteurs de plateforme.

La page **Vie scolaire** donne accès aux absences/retards, appréciations, décisions du conseil et archives. Les données correspondantes sont accessibles sous `/api/school-life` :

- `GET/POST /attendance`, `PATCH/DELETE /attendance/:id` — événements d'absence ou de retard.
- `GET/PUT /appreciations`, `DELETE /appreciations/:id` — appréciations disciplinaires.
- `GET/POST /council-decisions`, `POST /council-decisions/:id/validate` — décisions versionnées ; seul un administrateur d'établissement peut les valider.
- `GET /archives?academicYearId=...` — versions des bulletins, bilans et présences des années clôturées.
- `GET /history?entityType=...&entityId=...` — journal des modifications d'un élément.
- `PATCH /api/annual-summaries/:id` — mention et appréciation d'un bilan avant publication (la décision du conseil ne peut pas être saisie directement).

Les écritures exigent une session et un jeton CSRF (`X-CSRF-Token`). Les bulletins et bilans figent les totaux d'absences/retards ; les bulletins figent aussi les appréciations disciplinaires, et les bilans uniquement les décisions validées.

## Parcours d'interface

Les tests Playwright (API simulée pour isoler l'interface) couvrent le tableau de bord, l'enregistrement d'une absence, la saisie de notes en largeur mobile et la page 404 :

```powershell
cd frontend
npm run test:e2e
```

Le parcours complet de la section 20 utilise l'API PostgreSQL réelle et Chromium :

```powershell
cd backend
npm run test:e2e:real
```

Cette commande est réservée au développement local. Elle crée, puis réinitialise à chaque exécution, une base dédiée nommée `<nom-de-DATABASE_URL>_e2e` sur la même instance PostgreSQL locale. L'utilisateur PostgreSQL doit pouvoir créer une base. La commande refuse les serveurs distants et les bases applicative ou de tests. Les établissements et comptes créés par le parcours sont fictifs.

## Tests

```powershell
cd backend
npm test
npm audit

cd ../frontend
npm test
npm audit
```

## Structure

```
bs/
├── backend/          API Express + Prisma
│   ├── prisma/       Schéma et migrations
│   ├── src/          Code source
│   └── tests/        Tests Vitest + Supertest
├── frontend/         Application Tauri + React
│   ├── src/          Interface React
│   └── src-tauri/    Coque native Tauri (Rust)
├── docs/             Cahier des charges et décisions
├── prompts/          Prompts des phases
└── docker-compose.yml
```

## Dépannage

- **`rustc` introuvable** : installer Rust via rustup, puis rouvrir PowerShell.
- **Port 5432 déjà utilisé** : changer `POSTGRES_PORT` dans `.env`.
- **CORS / session refusés dans Tauri** : vérifier `CORS_ORIGINS` et utiliser `http://tauri.localhost` (Windows).
- **Erreur Prisma de connexion** : vérifier que le conteneur `db` est sain (`docker compose ps`).
