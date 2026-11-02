#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use tauri::{Manager, WindowEvent};
use tauri_plugin_updater::{Update, UpdaterExt};

/// Délai entre deux vérifications de mise à jour en tâche de fond.
const INTERVALLE_VERIFICATION: Duration = Duration::from_secs(4 * 60 * 60);
/// Fichier temporaire où le paquet téléchargé est conservé jusqu'à la fermeture
/// de la fenêtre (on ne garde pas l'octet-array complet en RAM en continu).
const FICHIER_PAQUET: &str = "bulletins-scolaires-update.pkg";

/// Mise à jour téléchargée et déjà validée en signature : prête à être
/// installée silencieusement à la fermeture de la fenêtre.
struct MiseAJourPret {
    update: Update,
    chemin_paquet: PathBuf,
}

/// État partagé entre le daemon de vérification et le gestionnaire de fermeture.
struct EtatMiseAJour(Mutex<Option<MiseAJourPret>>);

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            app.manage(EtatMiseAJour(Mutex::new(None)));
            // Pas de vérification en développement (`tauri dev`) : l'endpoint ne
            // sert qu'aux builds officiels signupés.
            if !cfg!(debug_assertions) {
                demarrer_verifications(app.handle().clone());
            }
            Ok(())
        })
        .on_window_event(|fenetre, evenement| {
            if let WindowEvent::CloseRequested { api, .. } = evenement {
                if !installer_mise_a_jour(fenetre.app_handle()) {
                    // Aucun paquet prêt (ou installation impossible) : fermeture
                    // normale, rien d'inhabituel pour l'utilisateur.
                    return;
                }
                // L'installateur silencieux a été lancé : on bloque la fermeture
                // puis on termine le process. Windows : le plugin a déjà appelé
                // exit lui-même après avoir exécuté l'installateur NSIS (ce code
                // ne cours plus). Linux : l'AppImage est remplacée, il reste à
                // quitter proprement.
                api.prevent_close();
                std::process::exit(0);
            }
        })
        .run(tauri::generate_context!())
        .expect("erreur au démarrage de l'application Tauri");
}

/// Daemon de mise à jour : vérifie au démarrage puis toutes les
/// `INTERVALLE_VERIFICATION` s'il existe une nouvelle version ; la télécharge
/// silencieusement en tâche de fond. L'application fonctionne normalement,
/// rien n'est affiché, l'utilisateur ne sait rien.
fn demarrer_verifications(app: tauri::AppHandle) {
    std::thread::spawn(move || loop {
        if let Err(erreur) = tauri::async_runtime::block_on(verifier_et_telecharger(&app)) {
            // Offline, endpoint indisponible, etc. : on réessaie plus tard, sans
            // déranger quiconque.
            #[cfg(debug_assertions)]
            eprintln!("Vérification mise à jour : {erreur}");
            let _ = &erreur;
        }
        std::thread::sleep(INTERVALLE_VERIFICATION);
    });
}

/// Vérifie l'endpoint configuré puis, si une version plus récente existe,
/// télécharge et vérifie le paquet en arrière-plan pour le rendre prêt à
/// l'installation à la fermeture.
async fn verifier_et_telecharger(app: &tauri::AppHandle) -> Result<(), String> {
    // `restart_after_install(false)` : l'installateur NSIS ne relance PAS l'app
    // après l'installation — l'utilisateur l'ouvrira elle-même la prochaine fois,
    // elle tournera alors sur la nouvelle version.
    let receuilleur = app
        .updater_builder()
        .restart_after_install(false)
        .build()
        .map_err(|erreur| erreur.to_string())?;

    let Some(update) = receuilleur.check().await.map_err(|erreur| erreur.to_string())?
    else {
        return Ok(()); // à jour
    };

    {
        // Déjà en attente pour cette version ? On ne retélécharge pas à chaque cycle.
        let etat = app.state::<EtatMiseAJour>();
        let deja_pret = etat.0.lock().unwrap().as_ref().map(|pret| pret.update.version.clone());
        if deja_pret.as_deref() == Some(update.version.as_str()) {
            return Ok(());
        }
    }

    // Signature du paquet vérifiée avec la clé publique pendant le téléchargement.
    let octets = update
        .download(|_, _| {}, || {})
        .await
        .map_err(|erreur| erreur.to_string())?;

    let chemin_paquet = std::env::temp_dir().join(FICHIER_PAQUET);
    std::fs::write(&chemin_paquet, &octets).map_err(|erreur| erreur.to_string())?;

    let etat = app.state::<EtatMiseAJour>();
    *etat.0.lock().unwrap() = Some(MiseAJourPret { update, chemin_paquet });
    Ok(())
}

/// Installation à la fermeture de la fenêtre. Retourne `true` si une mise à
/// jour a effectivement été installée, sinon `false` (fermeture normale).
fn installer_mise_a_jour(app: &tauri::AppHandle) -> bool {
    let Some(pret) = app.state::<EtatMiseAJour>().0.lock().unwrap().take() else {
        return false;
    };
    let Ok(octets) = std::fs::read(&pret.chemin_paquet) else {
        return false;
    };
    if let Err(erreur) = pret.update.install(octets) {
        // Windows : lance l'installateur NSIS en mode silencieux (configuré via
        // plugins.updater.windows.installMode = "quiet"). Linux : remplace
        // l'AppImage sur disque. En cas d'échec, la fermeture normale reprend.
        #[cfg(debug_assertions)]
        eprintln!("Installation de la mise à jour impossible : {erreur}");
        let _ = &erreur;
        return false;
    }
    true
}
