import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  chargerAnnees,
  chargerBilanAnnuel,
  chargerCalculs,
  chargerClasses,
  type BilanAnnuelEleve,
  type ResultatsClasse,
  type YearSemestre,
} from '@/lib/notes';

/**
 * Page « Calcul et classement ».
 * Aucune arithmétique ici : le tableau affiche les chaînes renvoyées par le serveur
 * (valeur affichée déjà arrondie, valeur exacte en infobulle).
 */

type Onglet = 'semestre' | 'annual';

export function CalculsPage() {
  const [onglet, setOnglet] = useState<Onglet>('semestre');
  const [classes, setClasses] = useState<{ id: string; name: string; academicYear: { id: string } }[]>([]);
  const [annees, setAnnees] = useState<YearSemestre[]>([]);
  const [classroomId, setClassroomId] = useState('');
  const [semesterId, setSemesterId] = useState('');
  const [previsualisation, setPrevisualisation] = useState(false);
  const [resultats, setResultats] = useState<ResultatsClasse | null>(null);
  const [bilan, setBilan] = useState<BilanAnnuelEleve[]>([]);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [c, a] = await Promise.all([chargerClasses(), chargerAnnees()]);
      setClasses(c.classes);
      setAnnees(a.years);
      if (c.classes[0]) setClassroomId(c.classes[0].id);
    })().catch((e) => setErreur((e as Error).message));
  }, []);

  const classe = useMemo(() => classes.find((c) => c.id === classroomId), [classes, classroomId]);

  const semestres = useMemo(
    () => annees.find((a) => a.id === classe?.academicYear.id)?.semesters ?? [],
    [annees, classe]
  );

  useEffect(() => {
    if (semestres.length && !semestres.some((s) => s.id === semesterId)) {
      setSemesterId(semestres[0].id);
    }
  }, [semestres, semesterId]);

  useEffect(() => {
    if (!classroomId) return;
    setChargement(true);
    setErreur(null);
    if (onglet === 'semestre') {
      if (!semesterId) {
        setChargement(false);
        return;
      }
      chargerCalculs({ classroomId, semesterId, inclureBrouillons: previsualisation })
        .then(setResultats)
        .catch((e) => {
          setResultats(null);
          setErreur((e as Error).message);
        })
        .finally(() => setChargement(false));
      return;
    }
    if (!classe) {
      setChargement(false);
      return;
    }
    chargerBilanAnnuel({ classroomId, academicYearId: classe.academicYear.id })
      .then((reponse) => setBilan(reponse.eleves))
      .catch((e) => {
        setBilan([]);
        setErreur((e as Error).message);
      })
      .finally(() => setChargement(false));
  }, [onglet, classroomId, semesterId, previsualisation, classe]);

  // Colonnes de matières : ordre renvoyé par le serveur, regroupé depuis l'ensemble des élèves.
  const matieres = useMemo(() => {
    if (!resultats) return [] as { subjectId: string; subjectName: string; coefficient: string | null }[];
    const vues = new Map<string, { subjectId: string; subjectName: string; coefficient: string | null }>();
    for (const eleve of resultats.eleves) {
      for (const matiere of eleve.matieres) {
        if (!vues.has(matiere.subjectId)) {
          vues.set(matiere.subjectId, {
            subjectId: matiere.subjectId,
            subjectName: matiere.subjectName,
            coefficient: matiere.coefficient,
          });
        }
      }
    }
    return [...vues.values()];
  }, [resultats]);

  const classement = useMemo(() => {
    if (!resultats) return [];
    // Tri serveur conservé : on n'a recalcule rien, on se contente d'afficher le rang renvoyé.
    return resultats.eleves;
  }, [resultats]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Calcul et classement</h1>
        <p className="text-sm text-muted-foreground">
          Moyennes, points pondérés, moyenne générale et rangs sont calculés par le serveur. Les
          évaluations non validées sont exclues du calcul officiel.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={onglet === 'semestre' ? 'default' : 'outline'}
          onClick={() => setOnglet('semestre')}
        >
          Semestre
        </Button>
        <Button
          size="sm"
          variant={onglet === 'annual' ? 'default' : 'outline'}
          onClick={() => setOnglet('annual')}
        >
          Bilan annuel
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border p-4">
        <label className="text-sm">
          <span className="text-muted-foreground">Classe</span>
          <select
            className="mt-1 block rounded-md border border-input px-2 py-2 text-sm"
            value={classroomId}
            onChange={(event) => setClassroomId(event.target.value)}
          >
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        {onglet === 'semestre' ? (
          <label className="text-sm">
            <span className="text-muted-foreground">Semestre</span>
            <select
              className="mt-1 block rounded-md border border-input px-2 py-2 text-sm"
              value={semesterId}
              onChange={(event) => setSemesterId(event.target.value)}
            >
              {semestres.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="text-sm text-muted-foreground">
            Année {classe?.academicYear.id ? annees.find((a) => a.id === classe.academicYear.id)?.name : ''}
          </p>
        )}
        {onglet === 'semestre' ? (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-input"
              checked={previsualisation}
              onChange={(event) => setPrevisualisation(event.target.checked)}
            />
            <span>
              Inclure les évaluations non validées
              <span className="ml-1 text-xs text-muted-foreground">(prévisualisation)</span>
            </span>
          </label>
        ) : null}
        {erreur ? <p className="text-sm text-destructive">{erreur}</p> : null}
      </div>

      {chargement ? <p className="text-sm text-muted-foreground">Calcul en cours…</p> : null}

      {onglet === 'semestre' && resultats ? (
        <div className="space-y-3">
          {resultats.motifs.length > 0 ? (
            <ul className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
              {resultats.motifs.map((motif) => (
                <li key={motif}>{motif}</li>
              ))}
            </ul>
          ) : null}

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="p-3 text-left">Rang</th>
                  <th className="p-3 text-left">Matricule</th>
                  <th className="p-3 text-left">Nom</th>
                  {matieres.map((matiere) => (
                    <th key={matiere.subjectId} className="p-3 text-right">
                      {matiere.subjectName}
                      {matiere.coefficient ? (
                        <span className="ml-1 text-xs text-muted-foreground">
                          (coef {matiere.coefficient})
                        </span>
                      ) : null}
                    </th>
                  ))}
                  <th className="p-3 text-right">Moyenne générale</th>
                  <th className="p-3 text-right">Points / Coef</th>
                </tr>
              </thead>
              <tbody>
                {classement.length === 0 ? (
                  <tr>
                    <td colSpan={matieres.length + 5} className="p-3 text-muted-foreground">
                      Aucun élève actif dans cette classe.
                    </td>
                  </tr>
                ) : (
                  classement.map((eleve) => (
                    <tr key={eleve.enrollmentId} className="border-t border-border align-top">
                      <td className="p-3">
                        {eleve.rang ?? '—'}
                        {eleve.motifNonClasse ? (
                          <p className="text-xs text-muted-foreground">{eleve.motifNonClasse}</p>
                        ) : null}
                      </td>
                      <td className="p-3">{eleve.matricule}</td>
                      <td className="p-3">
                        {eleve.nom} {eleve.prenoms}
                        {eleve.incomplet ? (
                          <span className="ml-1 text-xs text-accent-foreground">saisie incomplète</span>
                        ) : null}
                      </td>
                      {matieres.map((matiere) => {
                        const resultat = eleve.matieres.find((m) => m.subjectId === matiere.subjectId);
                        return (
                          <td
                            key={matiere.subjectId}
                            className="p-3 text-right"
                            title={
                              resultat?.moyenneExacte && resultat.moyenneExacte !== resultat.moyenne
                                ? `Valeur exacte : ${resultat.moyenneExacte}`
                                : undefined
                            }
                          >
                            {resultat?.moyenne ?? '—'}
                            {resultat && resultat.motifs.length > 0 ? (
                              <p className="text-xs text-muted-foreground">{resultat.motifs.join(' · ')}</p>
                            ) : null}
                          </td>
                        );
                      })}
                      <td
                        className="p-3 text-right font-medium"
                        title={
                          eleve.moyenneGeneraleExacte
                            ? `Valeur exacte : ${eleve.moyenneGeneraleExacte}`
                            : undefined
                        }
                      >
                        {eleve.moyenneGenerale ?? '—'}
                      </td>
                      <td className="p-3 text-right text-muted-foreground">
                        {eleve.totalPoints} / {eleve.totalCoeficients}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot className="bg-muted/30">
                <tr>
                  <td className="p-3" colSpan={matieres.length + 4}>
                    <span className="font-medium">Moyenne de la classe</span>{' '}
                    <span className="text-xs text-muted-foreground">
                      (effectif {resultats.effectif}
                      {previsualisation ? ' · prévisualisation, non officiel' : ''})
                    </span>
                  </td>
                  <td
                    className="p-3 text-right font-medium"
                    title={
                      resultats.moyenneClasseExacte
                        ? `Valeur exacte : ${resultats.moyenneClasseExacte}`
                        : undefined
                    }
                  >
                    {resultats.moyenneClasse ?? '—'}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          <p className="text-xs text-muted-foreground">
            Les ex æquo partagent le même rang (1, 2, 2, 4). Survolez une moyenne générale pour voir
            la valeur exacte retenue avant affichage.
          </p>
        </div>
      ) : null}

      {onglet === 'annual' ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="p-3 text-left">Matricule</th>
                <th className="p-3 text-left">Nom</th>
                <th className="p-3 text-right">Semestre 1</th>
                <th className="p-3 text-right">Semestre 2</th>
                <th className="p-3 text-right">Moyenne annuelle</th>
              </tr>
            </thead>
            <tbody>
              {bilan.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-3 text-muted-foreground">
                    Aucun bilan annuel : il faut des notes validées dans les deux semestres.
                  </td>
                </tr>
              ) : (
                bilan.map((eleve) => (
                  <tr key={eleve.enrollmentId} className="border-t border-border align-top">
                    <td className="p-3">{eleve.matricule}</td>
                    <td className="p-3">
                      {eleve.nom} {eleve.prenoms}
                      {eleve.motifs.length > 0 ? (
                        <p className="text-xs text-muted-foreground">{eleve.motifs.join(' · ')}</p>
                      ) : null}
                    </td>
                    <td className="p-3 text-right">{eleve.s1 ?? '—'}</td>
                    <td className="p-3 text-right">{eleve.s2 ?? '—'}</td>
                    <td
                      className="p-3 text-right font-medium"
                      title={eleve.annuelleExacte ? `Valeur exacte : ${eleve.annuelleExacte}` : undefined}
                    >
                      {eleve.calculable ? eleve.annuelle : 'non calculable'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
