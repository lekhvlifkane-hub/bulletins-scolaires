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
 *     --win-exe "artifacts/…/Bulletins Scolaires_0.1.1_x64-setup.exe" \
 *     --win-sig "…" \
 *     --linux-appimage "artifacts/…/Bulletins Scolaires_0.1.1_amd64.AppImage" \
 *     --linux-sig "…"
 *
 * Champs de `latest.json` (ref. tauri-plugin-updater v2) :
 * { version, notes, pub_date, platforms: { "<target>": { signature, url } } }
 * La clé `signature` est le contenu du fichier `.sig` encodé en base64.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));

const tag = requireArg(args, '--tag');
const repo = requireArg(args, '--repo');
const dist = args['--dist'] ?? 'dist-update';
const version = tag.replace(/^v/, '');

const sources = [
  { target: 'windows-x86_64', file: requireArg(args, '--win-exe'), sig: requireArg(args, '--win-sig'), rename: `Bulletins-Scolaires_${version}_x64-setup.exe` },
  { target: 'linux-x86_64', file: requireArg(args, '--linux-appimage'), sig: requireArg(args, '--linux-sig'), rename: `Bulletins-Scolaires_${version}_amd64.AppImage` },
];

await fs.mkdir(dist, { recursive: true });
const platforms = {};

for (const src of sources) {
  // Le fichier `.sig` contient déjà la signature encodée en base64 : le
  // manifeste attend ce contenu tel quel (pas de double encodage).
  const signature = (await fs.readFile(src.sig, 'utf8')).trim();
  const destName = src.rename.replace(/\s+/g, '.');
  await fs.copyFile(src.file, path.join(dist, destName));
  await fs.copyFile(src.sig, path.join(dist, `${destName}.sig`));
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
