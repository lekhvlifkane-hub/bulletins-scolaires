import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import {
  LIBELLES_FORMULE_MATIERE,
  LIBELLES_STATUT_BULLETIN,
  ROLES_EDITION_BULLETIN,
  chargerBulletin,
  corrigerBulletin,
  modifierAppreciation,
  modifierChampsLibres,
  telechargerPdf,
  type DetailBulletin,
} from '@/lib/bulletins';

/**
 * Détail d'un bulletin : le snapshot figé, tel qu'il sera imprimé.
 * La page ne calcule rien — elle montre les valeurs servies, y compris « Non calculable »
 * et le décompte des notes manquantes. Les champs libres ne sont modifiables qu'avant
 * publication ; après, seule une correction versionnée est possible.
 */

function dateCourte(valeur: string | null): string {
  if (!valeur) return '—';
  return new Date(valeur).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

const LIBELLES_CATEGORIE: Record<string, string> = {
  DEVOIR: 'Devoir',
  COMPOSITION: 'Composition',
  AUTRE: 'Autre',
};

export function BulletinDetailPage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const peutEditer = user ? ROLES_EDITION_BULLETIN.includes(user.role) : false;

  const [detail, setDetail] = useState<DetailBulletin | null>(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [motif, setMotif] = useState('');
  const [champs, setChamps] = useState({ mention: '', appreciation: '' });
  const [appreciations, setAppreciations] = useState<Record<string, string>>({});
  const [enCours, setEnCours] = useState(false);

  const charger = useCallback(async () => {
    setChargement(true);
    try {
      const donnees = await chargerBulletin(id);
      setDetail(donnees);
      setChamps({
        mention: donnees.bulletin.mention ?? '',
        appreciation: donnees.bulletin.appreciation ?? '',
      });
      setAppreciations(
        Object.fromEntries(
          donnees.snapshot.matieres.map((m) => [m.subjectId, m.appreciation ?? ''])
        )
      );
      setErreur(null);
    } catch (e) {
      setDetail(null);
      setErreur((e as Error).message);
    } finally {
      setChargement(false);
    }
  }, [id]);

  useEffect(() => {
    if (id) void charger();
  }, [id, charger]);

  const publierChampsLibres = async () => {
    if (!detail) return;
    const { enrollmentId, semesterId } = detail.bulletin;
    setEnCours(true);
    try {
      await Promise.all([
        modifierChampsLibres(id, {
          mention: champs.mention.trim() || null,
          appreciation: champs.appreciation.trim() || null,
        }),
        ...Object.entries(appreciations).map(([subjectId, appreciation]) =>
          modifierAppreciation({
            enrollmentId,
            semesterId,
            subjectId,
            content: appreciation.trim() || null,
          })
        ),
      ]);
      setMessage('Champs libres enregistrés.');
      await charger();
    } catch (e) {
      setMessage(null);
      setErreur((e as Error).message);
    } finally {
      setEnCours(false);
    }
  };

  const corriger = async () => {
    setEnCours(true);
    try {
      const { bulletin } = await corrigerBulletin(id, motif.trim());
      setMessage(`Correction enregistrée : version ${bulletin.version}. `);
      setMotif('');
      await charger();
    } catch (e) {
      setMessage(null);
      setErreur((e as Error).message);
    } finally {
      setEnCours(false);
    }
  };

  const imprimer = async () => {
    setEnCours(true);
    try {
      const pdf = await telechargerPdf(`/api/report-cards/${encodeURIComponent(id)}/pdf`);
      setMessage(`PDF téléchargé : ${pdf.nom}${pdf.pages ? ` (${pdf.pages} page(s))` : ''}.`);
    } catch (e) {
      setMessage(null);
      setErreur((e as Error).message);
    } finally {
      setEnCours(false);
    }
  };

  if (chargement) {
    return <p className="text-sm text-muted-foreground">Chargement du bulletin…</p>;
  }

  if (!detail) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-destructive">{erreur ?? 'Bulletin introuvable.'}</p>
        <Link className="text-sm hover:underline" to="/bulletins">
          Retour à la liste des bulletins
        </Link>
      </div>
    );
  }

  const { bulletin, snapshot, historique } = detail;
  const publie = bulletin.statut === 'PUBLIE';
  const modifiable = peutEditer && !publie && bulletin.statut !== 'ANNULE';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            Bulletin {snapshot.enTete.semestre.nom} — {snapshot.eleve.nom} {snapshot.eleve.prenoms}
          </h1>
          <p className="text-sm text-muted-foreground">
            {snapshot.enTete.nomEtablissement} · {snapshot.eleve.classe}
            {snapshot.eleve.niveau ? ` · ${snapshot.eleve.niveau}` : ''} ·{' '}
            {snapshot.enTete.anneeScolaire.nom} · matricule {snapshot.eleve.matricule}
          </p>
          <p className="mt-1 text-sm">
            <span className="rounded-md border border-border px-2 py-0.5 text-xs">
              {LIBELLES_STATUT_BULLETIN[bulletin.statut]} · v{bulletin.version}
            </span>
            <span className="ml-2 text-xs text-muted-foreground">
              généré le {dateCourte(bulletin.genereLe)}
              {bulletin.publieLe ? ` · publié le ${dateCourte(bulletin.publieLe)}` : ''}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => void imprimer()} disabled={enCours}>
            Imprimer en PDF
          </Button>
          <Link
            className="rounded-md border border-input px-3 py-2 text-sm hover:bg-muted"
            to={`/comparaison-semestres?classroomId=${snapshot.eleve.classroomId}&enrollmentId=${snapshot.eleve.enrollmentId}&academicYearId=${bulletin.academicYearId}`}
          >
            Comparer S1 / S2
          </Link>
          <Link
            className="rounded-md border border-input px-3 py-2 text-sm hover:bg-muted"
            to="/bulletins"
          >
            Retour
          </Link>
        </div>
      </div>

      {erreur ? <p className="text-sm text-destructive">{erreur}</p> : null}
      {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}

      {snapshot.motifs.length > 0 || bulletin.motifNonClasse ? (
        <ul className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          {snapshot.motifs.map((motifManque) => (
            <li key={motifManque}>{motifManque}</li>
          ))}
          {bulletin.motifNonClasse ? <li key="non-classe">{bulletin.motifNonClasse}</li> : null}
        </ul>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="p-3 text-left">Discipline</th>
              <th className="p-3 text-right">Coef.</th>
              <th className="p-3 text-right">Moyenne</th>
              <th className="p-3 text-right">Points</th>
              <th className="p-3 text-right">Rang</th>
              <th className="p-3 text-left">Évaluations retenues</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.matieres.map((matiere) => (
              <tr key={matiere.subjectId} className="border-t border-border align-top">
                <td className="p-3">
                  <span className="font-medium">{matiere.subjectName}</span>
                  {!matiere.comptabilisee ? (
                    <span className="ml-1 text-xs text-muted-foreground">(non comptabilisée)</span>
                  ) : null}
                  {matiere.incomplet ? (
                    <span className="ml-1 text-xs text-accent-foreground">incomplète</span>
                  ) : null}
                  {matiere.motifs.length > 0 ? (
                    <p className="text-xs text-muted-foreground">{matiere.motifs.join(' · ')}</p>
                  ) : null}
                </td>
                <td className="p-3 text-right">
                  {matiere.coefficient ?? '—'}
                  {!matiere.coefficientValide ? (
                    <p className="text-xs text-destructive">coef. invalide</p>
                  ) : null}
                </td>
                <td
                  className="p-3 text-right font-medium"
                  title={
                    matiere.moyenneExacte &&
                    matiere.moyenneExacte !== (matiere.moyenneAffichee ?? matiere.moyenne)
                      ? `Valeur exacte : ${matiere.moyenneExacte}`
                      : undefined
                  }
                >
                  {matiere.moyenneAffichee ?? matiere.moyenne ?? 'Non calculable'}
                </td>
                <td className="p-3 text-right text-muted-foreground">
                  {matiere.pointsPonderes ?? '—'}
                </td>
                <td className="p-3 text-right">{matiere.rang ?? '—'}</td>
                <td className="p-3">
                  {matiere.groupes.length === 0 ? (
                    <span className="text-muted-foreground">Aucune évaluation retenue</span>
                  ) : (
                    matiere.groupes.map((groupe) => (
                      <p key={groupe.category} className="text-xs text-muted-foreground">
                        {LIBELLES_CATEGORIE[groupe.category] ?? groupe.category} (poids {groupe.poids})
                        {' : '}
                        {groupe.moyenneAffichee ?? 'Non calculable'} · {groupe.notesValides}/{groupe.notesAttendues}{' '}
                        note(s)
                        {groupe.notes.map((note) =>
                          note.score === null ? ` — ${note.title} (${note.status})` : ''
                        ).join('')}
                      </p>
                    ))
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-muted/30">
            <tr>
              <td className="p-3">
                <span className="font-medium">Moyenne générale</span>{' '}
                <span className="text-xs text-muted-foreground">
                  {snapshot.synthese.totalPoints} pts / {snapshot.synthese.totalCoeficients} coef ·
                  effectif {snapshot.synthese.effectif}
                </span>
              </td>
              <td />
              <td
                className="p-3 text-right font-semibold"
                title={
                  snapshot.synthese.moyenneGeneraleExacte
                    ? `Valeur exacte : ${snapshot.synthese.moyenneGeneraleExacte}`
                    : undefined
                }
              >
                {snapshot.synthese.moyenneGeneraleAffichee ??
                  snapshot.synthese.moyenneGenerale ??
                  'Non calculable'}
              </td>
              <td />
              <td className="p-3 text-right">{snapshot.synthese.rang ?? '—'}</td>
              <td className="p-3 text-xs text-muted-foreground">
                Moyenne de classe :{' '}
                {snapshot.synthese.moyenneClasseAffichee ?? snapshot.synthese.moyenneClasse ?? '—'}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {snapshot.continuite.semestrePrecedent ? (
        <div className="rounded-lg border border-border p-4 text-sm">
          <h2 className="font-medium">Continuité entre semestres</h2>
          <p className="text-muted-foreground">
            Semestre {snapshot.continuite.semestrePrecedent.numero} :{' '}
            {snapshot.continuite.semestrePrecedent.moyenneGeneraleAffichee ?? 'Non calculable'} ·
            rang {snapshot.continuite.semestrePrecedent.rang ?? '—'} ·{' '}
            {snapshot.continuite.semestrePrecedent.statut
              ? LIBELLES_STATUT_BULLETIN[snapshot.continuite.semestrePrecedent.statut]
              : 'aucun bulletin'}
            {snapshot.continuite.changementClasse && snapshot.continuite.classePrecedente
              ? ` · classe précédente : ${snapshot.continuite.classePrecedente}`
              : ''}
          </p>
        </div>
      ) : null}

      <section className="rounded-lg border border-border p-4 text-sm">
        <h2 className="font-medium">Absences et retards</h2>
        {snapshot.absences?.disponible ? (
          <p className="mt-2 text-muted-foreground">
            Absences justifiées : {snapshot.absences.absencesJustifiees} · non justifiées :{' '}
            {snapshot.absences.absencesNonJustifiees} · retards : {snapshot.absences.retards} (
            {snapshot.absences.minutesRetard} min)
          </p>
        ) : (
          <p className="mt-2 text-muted-foreground">
            Les données de présence ne sont pas disponibles sur cette ancienne version du bulletin.
          </p>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-3 rounded-lg border border-border p-4">
          <h2 className="font-medium">Champs libres</h2>
          {modifiable ? (
            <>
              <label className="block text-sm">
                <span className="text-muted-foreground">Mention</span>
                <input
                  className="mt-1 w-full rounded-md border border-input px-2 py-2 text-sm"
                  value={champs.mention}
                  maxLength={120}
                  onChange={(event) => setChamps({ ...champs, mention: event.target.value })}
                />
              </label>
              <label className="block text-sm">
                <span className="text-muted-foreground">Appréciation générale</span>
                <textarea
                  className="mt-1 w-full rounded-md border border-input px-2 py-2 text-sm"
                  rows={3}
                  maxLength={500}
                  value={champs.appreciation}
                  onChange={(event) => setChamps({ ...champs, appreciation: event.target.value })}
                />
              </label>
              <Button size="sm" onClick={() => void publierChampsLibres()} disabled={enCours}>
                Enregistrer les champs libres
              </Button>
            </>
          ) : (
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Mention</dt>
                <dd>{bulletin.mention ?? 'Non renseigné'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Appréciation</dt>
                <dd>{bulletin.appreciation ?? 'Non renseigné'}</dd>
              </div>
            </dl>
          )}
          {publie ? (
            <p className="text-xs text-muted-foreground">
              Bulletin figé : la mention et les appréciations ne sont plus modifiables. Toute
              correction passe par une nouvelle version.
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            La décision du conseil est annuelle et n’apparaît qu’après validation dans le bilan annuel.
          </p>
        </section>

        <section className="space-y-3 rounded-lg border border-border p-4">
          <h2 className="font-medium">Versions</h2>
          <ul className="space-y-2 text-sm">
            {historique.map((version) => (
              <li key={version.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  v{version.version} · {LIBELLES_STATUT_BULLETIN[version.statut]} ·{' '}
                  {version.moyenneGenerale ?? 'Non calculable'}
                  {version.estCourant ? ' · courant' : ''}
                </span>
                <span className="text-xs text-muted-foreground">
                  {dateCourte(version.publieLe ?? version.genereLe)}
                  {version.motifCorrection ? ` · ${version.motifCorrection}` : ''}
                </span>
              </li>
            ))}
          </ul>
          {peutEditer && publie ? (
            <div className="space-y-2 border-t border-border pt-3">
              <label className="block text-sm">
                <span className="text-muted-foreground">
                  Motif de la correction (obligatoire, 3 caractères minimum)
                </span>
                <input
                  className="mt-1 w-full rounded-md border border-input px-2 py-2 text-sm"
                  value={motif}
                  maxLength={300}
                  placeholder="Ex. : note de composition régularisée après vérification"
                  onChange={(event) => setMotif(event.target.value)}
                />
              </label>
              <Button
                size="sm"
                onClick={() => void corriger()}
                disabled={enCours || motif.trim().length < 3}
              >
                Créer une version corrigée
              </Button>
              <p className="text-xs text-muted-foreground">
                La version {bulletin.version} est archivée intacte ; la nouvelle recalcule le snapshot
                avec les paramètres du jour.
              </p>
            </div>
          ) : null}
        </section>
      </div>

      <p className="text-xs text-muted-foreground">
        Barème {snapshot.regles.baremeParDefaut}/20 · arrondi {snapshot.regles.arrondiDecimales}{' '}
        décimale(s) ·{' '}
        {LIBELLES_FORMULE_MATIERE[snapshot.regles.formuleMatiere] ?? snapshot.regles.formuleMatiere}.
        Ces règles sont celles enregistrées dans le snapshot, pas les réglages actuels de
        l’établissement.
      </p>
    </div>
  );
}
