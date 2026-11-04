#!/usr/bin/env node
/**
 * Assemble `latest.json` — le manifeste de mise à jour attendu par le plugin
 * updater Tauri v2 — à partir des artefacts du build, et normalise leur nom
 * dans un dossier dist (pour des URLs GitHub Releases stables).
 *
 * Usage (dans le job `publish` du workflow) :
 *   node scripts/build-latest-json.mjs \
 *     --tag v0.1.1 \
 *     --repo Nouhoudiallo/bulletins-scolaires-updates \
 *     --dist dist-update \
 *     --artifacts-dir artifacts-update
 *
 * Le script explore `--artifacts-dir` récursivement (les artefacts GitHub
 * peuvent être déposés à plat ou dans des sous-dossiers) et retrouve lui-même
 * l'installateur Windows, l'AppImage Linux et leurs fichiers `.sig`. Il échoue
 * avec un message explicite (et la liste des fichiers présents) si un fichier
 * manque, au lieu de tenter de lire un dossier.
 *
 * Champs de `latest.json` (ref. tauri-plugin-updater v2) :
 * { version, notes, pub_date, platforms: { "<target>": { signature, url } } }
 * La clé `signature` est le contenu du fichier `.sig` TEL QUEL (déjà base64 :
 * ne pas le ré-encoder).
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));

const tag = requireArg(args, '--tag');
const repo = requireArg(args, '--repo');
const dist = args['--dist'] ?? 'dist-update';
const artifactsDir = args['--artifacts-dir'] ?? 'artifacts-update';
const version = tag.replace(/^v/, '');

const files = await listFiles(artifactsDir);

/**
 * Windows : `<Produit>_<version>_x64-setup.exe` (+ `.sig`).
 * Linux   : `<Produit>_<version>_amd64.AppImage` (+ `.sig`) ; certaines
 *           versions de Tauri produisent une archive `.AppImage.tar.gz` signée
 *           à la place — on la préfère uniquement si l'AppImage brute manque.
 */
const sources = [
  {
    target: 'windows-x86_64',
    candidates: [/_x64-setup\.exe$/i],
    rename: () => `Bulletins-Scolaires_${version}_x64-setup.exe`,
  },
  {
    target: 'linux-x86_64',
    candidates: [/_amd64\.AppImage$/i, /_amd64\.AppImage\.tar\.gz$/i],
    rename: (file) =>
      `Bulletins-Scolaires_${version}_amd64.AppImage${file.endsWith('.tar.gz') ? '.tar.gz' : ''}`,
  },
];

await fs.mkdir(dist, { recursive: true });
const platforms = {};
const used = new Set();

for (const src of sources) {
  const file = pick(src.target, src.candidates, files, used);
  const sig = `${file}.sig`;

  if (!files.includes(sig)) {
    fail(
      `Signature introuvable pour ${path.basename(file)} : ${path.basename(sig)} absent de ${artifactsDir}.`,
    );
  }
  used.add(file);
  used.add(sig);

  // Le fichier `.sig` contient déjà la signature encodée en base64 : le
  // manifeste attend ce contenu tel quel (pas de double encodage).
  const signature = (await fs.readFile(sig, 'utf8')).trim();
  if (!signature.startsWith('untrusted comment:')) {
    fail(`Le fichier ${path.basename(sig)} n'a pas le format d'une signature minisign.`);
  }

  const destName = src.rename(file).replace(/\s+/g, '.');
  await fs.copyFile(file, path.join(dist, destName));
  await fs.copyFile(sig, path.join(dist, `${destName}.sig`));

  platforms[src.target] = {
    signature,
    url: `https://github.com/${repo}/releases/download/${tag}/${destName}`,
  };
}

const manifest = {
  version,
  notes: args['--notes'] ?? `Bulletins Scolaires ${version}`,
  pub_date: new Date().toISOString(),
  platforms,
};

await fs.writeFile(path.join(dist, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`latest.json écrit dans ${dist}/ : version ${version}, plateformes ${Object.keys(platforms).join(', ')}`);

/** Liste récursivement les fichiers réguliers d'un dossier (chemins relatifs). */
async function listFiles(root) {
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true, recursive: true });
  } catch (error) {
    fail(`Dossier d'artefacts illisible (${root}) : ${error.message}`);
  }

  const found = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    found.push(path.join(entry.parentPath ?? entry.path, entry.name));
  }
  if (found.length === 0) fail(`Aucun fichier dans ${root}.`);
  return found.sort();
}

/** Choisit l'unique fichier correspondant à l'un des motifs du target. */
function pick(target, patterns, pool, alreadyUsed) {
  const available = (pattern) =>
    pool.filter((file) => pattern.test(file) && !alreadyUsed.has(file));

  // Priorité aux fichiers effectivement signés (une archive peut être produite
  // sans `.sig` selon la plateforme).
  for (const requireSig of [true, false]) {
    for (const pattern of patterns) {
      const matches = available(pattern).filter((file) => !requireSig || pool.includes(`${file}.sig`));
      if (matches.length === 1) return matches[0];
      if (matches.length > 1) {
        fail(
          `Plusieurs fichiers correspondent à ${pattern} pour ${target} :\n  ${matches.join('\n  ')}`,
        );
      }
    }
  }
  fail(
    `Aucun fichier ne correspond aux motifs [${patterns.join(', ')}] pour ${target} dans ${artifactsDir}.\n` +
      `Fichiers présents :\n  ${pool.join('\n  ')}`,
  );
}

function fail(message) {
  console.error(`ERREUR : ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) out[argv[i]] = argv[i + 1] ?? '';
  }
  return out;
}

function requireArg(args, name) {
  const value = args[name];
  if (!value) {
    console.error(`Argument ${name} manquant. Voir l'en-tête du script.`);
    process.exit(1);
  }
  return value;
}
