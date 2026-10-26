import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  LIBELLES_STATUT_BULLETIN,
  chargerBilanAnnuel,
  telechargerPdf,
  type BilanResume,
  type SnapshotBilanAnnuel,
} from '@/lib/bulletins';
import { libelleMoyenne } from './BilanAnnuelPage';

/**
 * Détail du bilan annuel : le snapshot servi par le serveur, discipline par discipline.
 * Une moyenne absente reste « non calculable » ; rien n'est déduit ni complété ici.
 */

function dateCourte(valeur: string | null): string {
  if (!valeur) return '—';
  return new Date(valeur).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

export function BilanAnnuelDetailPage() {
  const { id = '' } = useParams();
  const [donnees, setDonnees] = useState<SnapshotBilanAnnuel | null>(null);
  const [resume, setResume] = useState<BilanResume | null>(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const charger = useCallback(async () => {
    setChargement(true);
    try {
      const detail = await chargerBilanAnnuel(id);
      setDonnees(detail.snapshot);
      setResume(detail.bilan);
      setErreur(null);
    } catch (e) {
      setDonnees(null);
      setErreur((e as Error).message);
    } finally {
      setChargement(false);
    }
  }, [id]);

  useEffect(() => {
    if (id) void charger();
  }, [id, charger]);

  const imprimer = async () => {
    try {
      const pdf = await telechargerPdf(`/api/annual-summaries/${encodeURIComponent(id)}/pdf`);
      setMessage(`PDF téléchargé : ${pdf.nom}${pdf.pages ? ` (${pdf.pages} page(s))` : ''}.`);
    } catch (e) {
      setMessage(null);
      setErreur((e as Error).message);
    }
  };

  if (chargement) return <p className="text-sm text-muted-foreground">Chargement du bilan…</p>;

  if (!donnees || !resume) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-destructive">{erreur ?? 'Bilan annuel introuvable.'}</p>
        <Link className="text-sm hover:underline" to="/bilan-annuel">
          Retour au bilan annuel
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            Bilan annuel — {donnees.eleve.nom} {donnees.eleve.prenoms}
          </h1>
          <p className="text-sm text-muted-foreground">
            {donnees.enTete.nomEtablissement} · {donnees.eleve.classe} ·{' '}
            {donnees.enTete.anneeScolaire.nom} · matricule {donnees.eleve.matricule}
          </p>
          <p className="mt-1 text-sm">
            <span className="rounded-md border border-border px-2 py-0.5 text-xs">
              {LIBELLES_STATUT_BULLETIN[resume.statut]} · v{resume.version}
            </span>
            <span className="ml-2 text-xs text-muted-foreground">
              généré le {dateCourte(resume.genereLe)}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => void imprimer()}>
            Imprimer en PDF
          </Button>
          <Link
            className="rounded-md border border-input px-3 py-2 text-sm hover:bg-muted"
            to={`/comparaison-semestres?enrollmentId=${donnees.eleve.enrollmentId}&academicYearId=${donnees.enTete.anneeScolaire.id}`}
          >
            Comparer S1 / S2
          </Link>
          <Link
            className="rounded-md border border-input px-3 py-2 text-sm hover:bg-muted"
            to="/bilan-annuel"
          >
            Retour
          </Link>
        </div>
      </div>

      {erreur ? <p className="text-sm text-destructive">{erreur}</p> : null}
      {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}

      {donnees.annuelle.motifs.length > 0 ? (
        <ul className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          {donnees.annuelle.motifs.map((motif) => (
            <li key={motif}>{motif}</li>
          ))}
        </ul>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        {donnees.semestres.map((semestre) => (
          <div key={semestre.numero} className="rounded-lg border border-border p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{semestre.nom}</p>
            <p className="mt-1 text-xl font-semibold">
              {semestre.moyenneGeneraleAffichee ?? 'Non calculable'}
            </p>
            <p className="text-sm text-muted-foreground">
              {semestre.reportCardId
                ? `${semestre.statut ? LIBELLES_STATUT_BULLETIN[semestre.statut] : 'Bulletin'} · v${semestre.version}`
                : 'Aucun bulletin'}
              {semestre.rang ? ` · rang ${semestre.rang}/${semestre.effectif}` : ''}
            </p>
          </div>
        ))}
        <div className="rounded-lg border border-border bg-muted/40 p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Moyenne annuelle</p>
          <p className="mt-1 text-xl font-semibold" title={donnees.annuelle.moyenneExacte ?? undefined}>
            {libelleMoyenne(resume)}
          </p>
          <p className="text-sm text-muted-foreground">
            {donnees.annuelle.rangAnnuel
              ? `Rang ${donnees.annuelle.rangAnnuel}/${donnees.annuelle.effectif}`
              : 'Non classé'}
            {donnees.annuelle.partiel ? ' · bilan partiel' : ''}
          </p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="p-3 text-left">Discipline</th>
              <th className="p-3 text-right">Coef.</th>
              <th className="p-3 text-right">Semestre 1</th>
              <th className="p-3 text-right">Semestre 2</th>
              <th className="p-3 text-right">Moyenne annuelle</th>
            </tr>
          </thead>
          <tbody>
            {donnees.matieres.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-3 text-muted-foreground">
                  Aucune discipline dans ce bilan.
                </td>
              </tr>
            ) : (
              donnees.matieres.map((matiere) => (
                <tr key={matiere.subjectId} className="border-t border-border align-top">
                  <td className="p-3">
                    {matiere.subjectName}
                    {matiere.motifs.length > 0 ? (
                      <p className="text-xs text-muted-foreground">{matiere.motifs.join(' · ')}</p>
                    ) : null}
                  </td>
                  <td className="p-3 text-right">{matiere.coefficient ?? '—'}</td>
                  <td className="p-3 text-right">{matiere.s1Affichee ?? 'Non calculable'}</td>
                  <td className="p-3 text-right">{matiere.s2Affichee ?? 'Non calculable'}</td>
                  <td className="p-3 text-right font-medium">
                    {matiere.annuelleAffichee ?? 'Non calculable'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <section className="rounded-lg border border-border p-4 text-sm">
        <h2 className="font-medium">Absences et retards sur l’année</h2>
        {donnees.absences?.disponible ? (
          <p className="mt-2 text-muted-foreground">
            Absences justifiées : {donnees.absences.absencesJustifiees} · non justifiées :{' '}
            {donnees.absences.absencesNonJustifiees} · retards : {donnees.absences.retards} (
            {donnees.absences.minutesRetard} min)
          </p>
        ) : (
          <p className="mt-2 text-muted-foreground">
            Les données de présence ne sont pas disponibles sur cette ancienne version du bilan.
          </p>
        )}
      </section>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-border p-4 text-sm">
          <p className="text-xs text-muted-foreground">Mention</p>
          <p>{donnees.mention ?? 'Non renseigné'}</p>
        </div>
        <div className="rounded-lg border border-border p-4 text-sm">
          <p className="text-xs text-muted-foreground">
            {donnees.decisionConseilValideeLe
              ? `Décision validée le ${dateCourte(donnees.decisionConseilValideeLe)}`
              : donnees.decisionConseil
                ? 'Décision historique (validation non consignée)'
                : 'Décision du conseil'}
          </p>
          <p>{donnees.decisionConseil ?? 'Non renseigné'}</p>
        </div>
        <div className="rounded-lg border border-border p-4 text-sm">
          <p className="text-xs text-muted-foreground">Appréciation</p>
          <p>{donnees.appreciation ?? 'Non renseigné'}</p>
        </div>
      </div>
    </div>
  );
}
