# Démonstration locale — backend sur la base « bulletins_demo » + interface web.
#
# Compte de démonstration : admin.fictif@demo.local / DemoPlateforme2026!
# Interface : http://localhost:1420
#
# N'utilise que des données fictives locales (règle AGENTS.md) : aucun accès
# à la production. La variable DATABASE_URL passée ici prime sur backend/.env
# (dotenv n'écrase pas une variable déjà définie).
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

$env:DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5432/bulletins_demo'
$env:VITE_API_PROXY_TARGET = 'http://localhost:4000'

Write-Host 'Démarrage du backend (base bulletins_demo)…'
Start-Process -FilePath 'cmd.exe' -ArgumentList '/k', 'npm run dev' -WorkingDirectory (Join-Path $root 'backend')

Start-Sleep -Seconds 4
Write-Host "Démarrage de l'interface (proxy vers le backend local)…"
Start-Process -FilePath 'cmd.exe' -ArgumentList '/k', 'npm run dev' -WorkingDirectory (Join-Path $root 'frontend')

Start-Sleep -Seconds 6
Write-Host ''
Write-Host 'Interface : http://localhost:1420'
Write-Host 'Compte    : admin.fictif@demo.local / DemoPlateforme2026!'
Write-Host 'Autres    : surveillant.fictif@demo.local et assistant.fictif@demo.local (même mot de passe)'
