#!/usr/bin/env node
/**
 * Prépare une publication desktop : synchronise la version dans les trois
 * fichiers sources, committe, puis crée le tag git qui déclenche le workflow
 * de publication (`.github/workflows/release.yml`).
 *
 * Usage :
 *   node scripts/release.mjs 0.1.1
 *
 * Le commit et le tag restent LOCAUX : les commandes de push affichées à la
 * fin doivent être exécutées explicitement.
 */
import fs from 'node:fs/promises';
import { execSync } from 'node:child_process';
import path from 'node:path';

const nouvelleVersion = process.argv[2];
if (!nouvelleVersion || !/^\d+\.\d+\.\d+$/.test(nouvelleVersion)) {
  console.error('Usage : node scripts/release.mjs <version> (ex. 0.1.1)');
  process.exit(1);
}

const racine = path.resolve(import.meta.dirname, '..');
const sources = [
  { fichier: 'bs/frontend/src-tauri/tauri.conf.json', cle: 'version tauri.conf.json' },
  { fichier: 'bs/frontend/package.json', cle: 'version package.json' },
  { fichier: 'bs/frontend/src-tauri/Cargo.toml', cle: 'version Cargo.toml' },
];

// Sanity : tout doit être propre et la version courante cohérente.
const statut = execSync('git status --porcelain', { cwd: racine, encoding: 'utf8' }).trim();
if (statut) {
  console.error('Git n\'est pas propre — committe d\'abord, puis relance ce script.');
  console.error(statut);
  process.exit(1);
}

const tag = `v${nouvelleVersion}`;
if (execSync(`git tag --list ${tag}`, { cwd: racine, encoding: 'utf8' }).trim()) {
  console.error(`Le tag ${tag} existe déjà.`);
  process.exit(1);
}

for (const { fichier } of sources) {
  const chemin = path.join(racine, fichier);
  const contenu = await fs.readFile(chemin, 'utf8');
  let apres;
  if (fichier.endsWith('.toml')) {
    apres = contenu.replace(/^version = ".*"$/m, `version = "${nouvelleVersion}"`);
  } else {
    apres = contenu.replace(/"version":\s*"[^"]+"/, `"version": "${nouvelleVersion}"`);
  }
  if (apres === contenu) throw new Error(`Version non trouvée dans ${fichier}`);
  await fs.writeFile(chemin, apres);
  console.log(`✓ ${fichier} → ${nouvelleVersion}`);
}

execSync(
  `git add ${sources.map((s) => s.fichier).join(' ')} && git commit -m "Version ${nouvelleVersion}" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"`,
  { cwd: racine, stdio: 'inherit' },
);
execSync(`git tag -a ${tag} -m "${tag} — mise à jour desktop"`, { cwd: racine });

console.log(`\nTag ${tag} créé localement. Pour publier les mises à jour :`);
console.log(`  git push origin main`);
console.log(`  git push origin ${tag}`);
console.log('Le workflow construit NSIS (Windows) + AppImage (Linux), signe et publie sur le repo public.');
