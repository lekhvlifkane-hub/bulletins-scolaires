import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  chargerAnnees,
  chargerClasses,
  type Classe,
  type YearSemestre,
} from '@/lib/notes';
import {
  LIBELLES_STATUT_BULLETIN,
  chargerBulletins,
  chargerComparaison,
  type ComparaisonSemestres,
  type LigneBulletin,
} from '@/lib/bulletins';

/**
 * Comparaison des deux semestres d'un élève.
 *
 * Les écarts sont calculés par le serveur à partir des snapshots figés : cette page
 * n'additionne ni ne soustrait rien. Quand une moyenne manque, le serveur renvoie un
 * motif et la page l'affiche au lieu d'imputer un écart.
 */

export function ComparaisonPage() {
  const [params, setParams] = useSearchParams();
  const [classes, setClasses] = useState<Classe[]>([]);
  const [annees, setAnnees] = useState<YearSemestre[]>([]);
  const [classroomId, setClassroomId] = useState(params.get('classroomId') ?? '');
  const [enrollmentId, setEnrollmentId] = useState(params.get('enrollmentId') ?? '');
  const [eleves, setEleves] = useState<LigneBulletin[]>([]);
  const [comparaison, setComparaison] = useState<ComparaisonSemestres | null>(null);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [c, a] = await Promise.all([chargerClasses(), chargerAnnees()]);
      setClasses(c.classes);
      setAnnees(a.years);
      if (!classroomId && c.classes[0]) setClassroomId(c.classes[0].id);
    })().catch((e) => setErreur((e as Error).message));
    // Un seul chargement des référentiels à l'ouverture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const classe = useMemo(() => classes.find((c) => c.id === classroomId), [classes, classroomId]);

  /**
   * L'année scolaire suit la classe : une classe appartient à une seule année, et comparer
   * les semestres d'une classe d'une autre année n'aurait pas de sens. Un lien direct
   * (depuis un bulletin) sans classe retombe sur l'année passée en paramètre.
   */
  const academicYearId = classe?.academicYear.id ?? params.get('academicYearId') ?? '';
  const annee = useMemo(
    () => annees.find((a) => a.id === academicYearId),
    [annees, academicYearId]
  );

  const chargerEleves = useCallback(async () => {
    if (!classroomId) {
      setEleves([]);
      return;
    }
    const semestre = annee?.semesters[0];
    if (!semestre) {
      setEleves([]);
      setErreur("Cette année scolaire n'a pas encore de semestre.");
      return;
    }
    try {
      const liste = await chargerBulletins({ classroomId, semesterId: semestre.id });
      setEleves(liste.lignes);
      setErreur(null);
    } catch (e) {
      setEleves([]);
      setErreur((e as Error).message);
    }
  }, [classroomId, annee]);

  useEffect(() => {
    if (!classroomId || !annee) return;
    void chargerEleves();
  }, [classroomId, annee, chargerEleves]);

  useEffect(() => {
    if (eleves.length && !eleves.some((l) => l.enrollmentId === enrollmentId)) {
      setEnrollmentId(eleves[0].enrollmentId);
    }
  }, [eleves, enrollmentId]);

  useEffect(() => {
    if (!enrollmentId || !academicYearId) {
      setComparaison(null);
      return;
    }
    setChargement(true);
    setErreur(null);
    chargerComparaison({ enrollmentId, academicYearId })
      .then((donnees) => {
        setComparaison(donnees);
        setParams((actuels) => {
          const suivant = new URLSearchParams(actuels);
          if (classroomId) suivant.set('classroomId', classroomId);
          suivant.set('enrollmentId', enrollmentId);
          suivant.set('academicYearId', academicYearId);
          return suivant;
        });
      })
      .catch((e) => {
        setComparaison(null);
        setErreur((e as Error).message);
      })
      .finally(() => setChargement(false));
  }, [enrollmentId, academicYearId, setParams]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Comparaison des semestres</h1>
        <p className="text-sm text-muted-foreground">
          Écarts S2 − S1 calculés par le serveur sur les bulletins figés. Un semestre sans bulletin
          ou sans moyenne est signalé, jamais remplacé par un zéro.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border p-4">
        <label className="text-sm">
          <span className="text-muted-foreground">Classe</span>
          <select
            className="mt-1 block rounded-md border border-input px-2 py-2 text-sm"
            value={classroomId}
            onChange={(event) => {
              setClassroomId(event.target.value);
              setEnrollmentId('');
            }}
          >
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <p className="text-sm">
          <span className="text-muted-foreground">Année scolaire</span>
          <span className="mt-1 block font-medium">{annee?.name ?? '—'}</span>
        </p>
        <label className="text-sm">
          <span className="text-muted-foreground">Élève</span>
          <select
            className="mt-1 block rounded-md border border-input px-2 py-2 text-sm"
            value={enrollmentId}
            onChange={(event) => setEnrollmentId(event.target.value)}
          >
            {eleves.map((l) => (
              <option key={l.enrollmentId} value={l.enrollmentId}>
                {l.nom} {l.prenoms}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-2">
          <Link
            className="rounded-md border border-input px-3 py-2 text-sm hover:bg-muted"
            to="/bulletins"
          >
            Bulletins
          </Link>
          <Link
            className="rounded-md border border-input px-3 py-2 text-sm hover:bg-muted"
            to={`/bilan-annuel?classroomId=${classroomId}&academicYearId=${academicYearId}`}
          >
            Bilan annuel
          </Link>
        </div>
      </div>

      {erreur ? <p className="text-sm text-destructive">{erreur}</p> : null}
      {chargement ? <p className="text-sm text-muted-foreground">Comparaison en cours…</p> : null}

      {comparaison ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            {comparaison.semestres.map((semestre) => (
              <div key={semestre.semestreId} className="rounded-lg border border-border p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {semestre.nom}
                </p>
                <p className="mt-1 text-2xl font-semibold">
                  {semestre.moyenneGeneraleAffichee ?? semestre.moyenneGenerale ?? 'Non calculable'}
                </p>
                <p className="text-sm text-muted-foreground">
                  {semestre.reportCardId
                    ? `${LIBELLES_STATUT_BULLETIN[semestre.statut ?? 'BOUILLON']} · v${semestre.version}`
                    : 'Aucun bulletin'}
                  {semestre.rang ? ` · rang ${semestre.rang}/${semestre.effectif}` : ''}
                </p>
                {semestre.motifs.length > 0 ? (
                  <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                    {semestre.motifs.map((motif) => (
                      <li key={motif}>{motif}</li>
                    ))}
                  </ul>
                ) : null}
                {semestre.reportCardId ? (
                  <Link
                    className="mt-2 inline-block text-xs hover:underline"
                    to={`/bulletins/${semestre.reportCardId}`}
                  >
                    Ouvrir le bulletin
                  </Link>
                ) : null}
              </div>
            ))}
            <div className="rounded-lg border border-border bg-muted/40 p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Écart sur la moyenne générale
              </p>
              <p className="mt-1 text-2xl font-semibold">
                {comparaison.generale.ecartAffiche ?? comparaison.generale.ecart ?? '—'}
              </p>
              <p className="text-sm text-muted-foreground">
                {comparaison.generale.motif
                  ? comparaison.generale.motif
                  : `Semestre 2 rapporté au semestre 1, barème ${comparaison.bareme}/20.`}
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
                  <th className="p-3 text-right">Écart</th>
                </tr>
              </thead>
              <tbody>
                {comparaison.matieres.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-3 text-muted-foreground">
                      Aucune discipline comparée : il faut au moins un bulletin disponible.
                    </td>
                  </tr>
                ) : (
                  comparaison.matieres.map((matiere) => (
                    <tr key={matiere.subjectId} className="border-t border-border">
                      <td className="p-3">{matiere.subjectName}</td>
                      <td className="p-3 text-right">{matiere.coefficient ?? '—'}</td>
                      <td className="p-3 text-right">{matiere.s1 ?? '—'}</td>
                      <td className="p-3 text-right">{matiere.s2 ?? '—'}</td>
                      <td className="p-3 text-right font-medium">
                        {matiere.ecartAffiche ?? matiere.ecart ?? 'non calculable'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-muted-foreground">
            {comparaison.classe} · {comparaison.anneeScolaire}. Les valeurs affichées sont celles des
            snapshots : modifier un réglage de calcul ne change pas cette comparaison.
          </p>
        </div>
      ) : null}

      {!comparaison && !chargement && eleves.length === 0 && !erreur ? (
        <p className="text-sm text-muted-foreground">
          Sélectionnez une classe pour comparer les deux semestres d’un élève.
        </p>
      ) : null}
    </div>
  );
}
