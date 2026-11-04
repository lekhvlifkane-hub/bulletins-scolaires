# Installation Windows et déploiement

## Installation locale sous Windows

### Prérequis

- Windows 10/11, PowerShell et Git.
- Node.js 22 LTS ou version ultérieure.
- Docker Desktop avec moteur Linux actif, pour PostgreSQL et l'API conteneurisée.
- Pour compiler l'application native : Rust stable via rustup, WebView2 et Visual Studio Build Tools avec la charge « Développement Desktop en C++ ».
- Pour sauvegarder/restaurer avec les scripts fournis : outils clients PostgreSQL (`pg_dump`, `pg_restore`, `psql`) présents dans `PATH`.

### Démarrer l'environnement

Depuis la racine du projet :

```powershell
Copy-Item .env.example .env
```

La configuration d'exemple est réservée au développement local. Démarrer l'API et PostgreSQL :

```powershell
docker compose up --build
```

Vérifier l'API sur <http://localhost:4000/api/health>. Les migrations Prisma sont appliquées par le conteneur backend avant le démarrage du serveur.

Lancer l'interface native dans un autre terminal :

```powershell
Set-Location frontend
npm ci
npm run tauri dev
```

Pour lancer seulement l'interface web de développement :

```powershell
npm run dev
```

Créer le premier compte administrateur plateforme avec un mot de passe temporaire fourni par l'opérateur :

```powershell
Set-Location ..\backend
npm ci
npx prisma generate
npm run create-platform-admin -- --email admin@exemple.sn --name "Administrateur plateforme"
```

Sans option `--password`, le script génère un secret aléatoire et l'affiche une seule fois. Le transmettre par un canal approprié, puis le changer après la première connexion.

Le jeu de démonstration est facultatif et limité aux bases locales. Il crée un établissement, des élèves et des notes explicitement fictifs. Pour définir le mot de passe des comptes fictifs avant le premier seed :

```powershell
$env:SEED_PASSWORD = "Choisir-Un-Secret-Temporaire-Unique"
npm run seed:demo
Remove-Item Env:SEED_PASSWORD
```

Sans `SEED_PASSWORD`, un secret aléatoire est généré et affiché une seule fois. Le seed refuse `NODE_ENV=production`, n'accepte que `localhost`, `127.0.0.1`, `::1` ou le service Docker local `db`, et n'écrase pas les données existantes.

## Déploiement en production

Le fichier Compose de développement n'est pas une configuration de production prête à exposer sur Internet. Préparer un hôte géré, isoler PostgreSQL sur un réseau privé, restreindre les ports entrants et mettre un proxy HTTPS (par exemple nginx ou Caddy) devant l'API.

### Secrets et transport

- Générer des valeurs indépendantes et aléatoires pour `POSTGRES_PASSWORD` et `SESSION_SECRET` (au moins 32 caractères). Pour le mot de passe PostgreSQL de Compose, choisir des caractères compatibles URL (par exemple une valeur hexadécimale aléatoire) ; l'injecter via le gestionnaire de secrets de l'hébergeur, jamais dans Git ni dans les journaux de déploiement.
- Configurer `NODE_ENV=production`, `SESSION_COOKIE_SECURE=true`, `SESSION_COOKIE_SAMESITE=lax` et une `DATABASE_URL` de production.
- L'API refuse désormais de démarrer en production si le secret de session est un exemple/faible ou si le cookie sécurisé est désactivé.
- N'autoriser que les origines frontend nécessaires dans `CORS_ORIGINS`. Le proxy doit terminer TLS, rediriger HTTP vers HTTPS et transmettre correctement les en-têtes `X-Forwarded-Proto`/`Host`.
- Ne publier ni le port PostgreSQL, ni l'interface d'administration de l'hôte. Ne servir `/api/docs` publiquement que si la politique d'exploitation l'autorise.
- Créer un compte plateforme initial avec le script dédié ; changer tout secret temporaire immédiatement.
- Définir `APP_BASE_URL` avec l'adresse publique HTTPS de l'interface (les liens des e-mails y sont rattachés) et renseigner le fournisseur d'envoi : `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`. L'API refuse de démarrer en production si `SMTP_HOST`/`SMTP_FROM` manquent ou si `APP_BASE_URL` pointe vers `localhost`. Vérifier ensuite qu'une invitation d'ouverture de compte arrive bien : les messages en échec restent visibles dans la file `EmailOutbox` (statut `ECHEC`), avec leur motif.

### Migrations et mises à jour

1. Sauvegarder la base et vérifier le fichier de sauvegarde avant chaque mise à jour.
2. Depuis `backend` et `frontend`, exécuter `npm audit` et traiter les avis avant publication.
3. Tester la version et ses migrations sur une copie de staging restaurée depuis une sauvegarde récente.
4. Construire et publier une image immuable depuis la version source revue.
5. Appliquer `npx prisma migrate deploy` comme étape contrôlée de déploiement, puis démarrer l'API et vérifier `/api/health`.
6. Effectuer un parcours de fumée (connexion, consultation d'un bulletin et PDF) et vérifier les logs.
7. En cas d'échec, ne pas exécuter `migrate reset` en production. Revenir à une version compatible et restaurer une sauvegarde validée selon le plan d'incident de l'établissement.

### Mises à jour automatiques de l'application de bureau

L'application de bureau (Tauri) s'auto-met à jour **silencieusement** après chaque publication de version. Aucune action de l'établissement n'est nécessaire.

**Fonctionnement**

- Au démarrage puis toutes les 4 h, l'app interroge `latest.json` sur le dépôt public `Nouhoudiallo/bulletins-scolaires-updates` ; si une version plus récente existe, elle est téléchargée en arrière-plan (invisible).
- À la **fermeture de la fenêtre**, le paquet téléchargé est installé silencieusement (NSIS `/S` sous Windows) ; l'app ne se relance pas seule. La prochaine ouverture utilise la nouvelle version.
- Chaque paquet est **signé** (clé Tauri) et vérifié avec la clé publique intégrée à l'app : un paquet non signé ou modifié est refusé.
- Si le téléchargement n'était pas terminé à la fermeture, rien n'est installé ; la vérification reprend à l'ouverture suivante.
- Support : **Windows (NSIS)** et **Linux (.AppImage uniquement)**. Les paquets `.deb`/`.rpm` ne sont pas mis à jour automatiquement — distribuer l'AppImage aux postes Linux.
- **Compatibilité Linux** : l'AppImage embarque webkit2gtk ; elle exige donc au maximum la glibc de la machine de build. La CI construit **dans un conteneur `ubuntu:22.04`** (glibc 2.35) et **échoue** si le paquet obtenu exige une glibc supérieure. Ne pas remplacer ce conteneur par un label de runner GitHub : un label ne garantit pas la version de l'image (et deux exécutions concurrentes sur un même tag peuvent publier des paquets différents — d'où le bloc `concurrency` du workflow, qui annule le run précédent).

**Publier une version**

1. S'assurer que `git status` est propre.
2. Lancer `node scripts/release.mjs 0.1.1` (le numéro de version est libre, il doit être **supérieur** à celui de l'app installée) : le script met à jour `tauri.conf.json`, `package.json` et `Cargo.toml`, crée le commit et le tag `v0.1.1`.
3. `git push origin main && git push origin v0.1.1` : le workflow `.github/workflows/release.yml` construit Windows + Linux, signe et publie sur le dépôt public des mises à jour.

**Secrets GitHub Actions requis** (repo privé, Settings > Secrets > Actions)

| Secret | Contenu |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | contenu de la clé privée générée par `tauri signer generate` (fichier `~/.tauri/bulletins-scolaires.key` sur la machine de build) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | mot de passe de cette clé |
| `RELEASES_PAT` | token GitHub fine-grained, accès `Contents: Read and write` sur `Nouhoudiallo/bulletins-scolaires-updates` uniquement |

> **Conserver la clé privée et son mot de passe hors du dépôt et en lieu sûr** (gestionnaire de secrets + sauvegarde). Perdue, il n'est plus possible de publier des mises à jour vers les installations existantes : il faudra republier une installation manuelle avec une nouvelle paire de clés.

**Première installation** : elle reste manuelle (téléchargement de l'installateur publié). Windows peut afficher un avis SmartScreen tant que l'installateur n'est pas signé Authenticode ; cela n'empêche pas l'installation. Les mises à jour suivantes sont silencieuses.

### Sauvegarde et test de restauration

Installer les outils clients PostgreSQL, configurer `DATABASE_URL` et `TEST_DATABASE_URL` dans `backend/.env` (ou l'environnement du processus), puis depuis `backend` :

```powershell
npm run db:backup
npm run db:test-restore -- ..\backups\bulletins-AAAA-MM-JJTHH-MM-SS.sssZ.dump
```

La sauvegarde est une archive PostgreSQL personnalisée avec un manifeste SHA-256 adjacent. Le test restaure dans une base temporaire nommée `bs_restore_check_*` de `TEST_DATABASE_URL`, vérifie le schéma et les migrations Prisma, puis supprime uniquement cette base temporaire. Il refuse une cible de test identique à `DATABASE_URL` ou un environnement `NODE_ENV=production`.

`TEST_DATABASE_URL` doit pointer vers une instance PostgreSQL de test/staging isolée, jamais vers la base de production. Conserver les sauvegardes chiffrées, hors du serveur de base, avec accès limité et une durée de rétention approuvée par l'établissement. Planifier et surveiller des sauvegardes automatisées au niveau de l'infrastructure ; les scripts de ce dépôt sont des commandes opérateur, pas un ordonnanceur.

La restauration est considérée vérifiée uniquement après exécution réussie de `db:test-restore` sur une sauvegarde récente. Faire périodiquement un exercice de reprise applicative complet ; un contrôle de schéma seul ne garantit ni la continuité réseau ni le délai de reprise attendu.

### Parcours E2E complet (développement local)

Depuis `backend`, lancer `npm run test:e2e:real`. Le scénario Playwright utilise PostgreSQL et l'API réels, démarre des services isolés sur les ports 4001 et 1421, et couvre la création des comptes et établissements, la saisie/validation des notes, les bulletins S1/S2, le bilan annuel, les PDF, la reconnexion et les permissions entre établissements.

La commande crée et réinitialise exclusivement `<nom-de-DATABASE_URL>_e2e` sur le même serveur PostgreSQL local ; elle refuse les hôtes distants, la base applicative, la base de tests et les noms ne correspondant pas à cette cible. L'utilisateur PostgreSQL doit avoir le droit `CREATEDB`. Ne jamais configurer cette commande avec un serveur contenant des données réelles. Les référentiels sans écran de configuration sont créés via l'API réelle ; les parcours de saisie, validation, publication et documents sont exercés dans l'interface Chromium.

## Limites fonctionnelles à valider

Avant tout usage officiel, faire approuver les règles scolaires, les mentions et la maquette PDF figurant dans [A_VALIDER.md](./A_VALIDER.md). Restent également à définir : le fournisseur d'e-mail de production (la file d'envoi est en place, mais aucun fournisseur n'est configuré) et la politique de conservation des données.
