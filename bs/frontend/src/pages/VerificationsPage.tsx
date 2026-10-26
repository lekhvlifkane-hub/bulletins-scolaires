import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import {
  LIBELLES_STATUT_EVALUATION,
  changerStatutEvaluation,
  chargerAnnees,
  chargerClasses,
  chargerEvaluations,
  type Evaluation,
  type StatutEvaluation,
  type YearSemestre,
} from '@/lib/notes';

/** Transitions proposées à l'interface ; le serveur refuse tout le reste. */
const TRANSITIONS: Record<StatutEvaluation, { vers: StatutEvaluation; label: string; exigeDroits?: boolean }[]> = {
  BOUILLON: [
    { vers: 'SAISIE_EN_COURS', label: 'Ouvrir la saisie' },
    { vers: 'A_VERIFIER', label: 'Envoyer à vérifier' },
  ],
  SAISIE_EN_COURS: [
    { vers: 'BOUILLON', label: 'Revenir en brouillon' },
    { vers: 'A_VERIFIER', label: 'Envoyer à vérifier' },
  ],
  A_VERIFIER: [
    { vers: 'SAISIE_EN_COURS', label: 'Renvoyer en saisie' },
    { vers: 'VALIDEE', label: 'Valider', exigeDroits: true },
  ],
  VALIDEE: [
    { vers: 'A_VERIFIER', label: 'Redevenir à vérifier', exigeDroits: true },
    { vers: 'PUBLIEE', label: 'Publier', exigeDroits: true },
  ],
  PUBLIEE: [],
};

function statutClasses(statut: StatutEvaluation) {
  if (statut === 'PUBLIEE') return 'bg-secondary text-secondary-foreground';
  if (statut === 'VALIDEE') return 'bg-primary text-primary-foreground';
  if (statut === 'A_VERIFIER') return 'bg-accent text-accent-foreground';
  return 'bg-muted text-muted-foreground';
}

export function VerificationsPage() {
  const { user } = useAuth();
  const [classes, setClasses] = useState<{ id: string; name: string; academicYear: { id: string } }[]>([]);
  const [annees, setAnnees] = useState<YearSemestre[]>([]);
  const [classroomId, setClassroomId] = useState('');
  const [semesterId, setSemesterId] = useState('');
  const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const peutValider = user?.role === 'SCHOOL_ADMIN' || user?.role === 'SURVEILLANT_GENERAL';

  useEffect(() => {
    (async () => {
      const [c, a] = await Promise.all([chargerClasses(), chargerAnnees()]);
      setClasses(c.classes);
      setAnnees(a.years);
      if (c.classes[0]) setClassroomId(c.classes[0].id);
    })().catch((e) => setErreur((e as Error).message));
  }, []);

  const semestres = useMemo(() => {
    const classe = classes.find((c) => c.id === classroomId);
    return annees.find((a) => a.id === classe?.academicYear.id)?.semesters ?? [];
  }, [classes, classroomId, annees]);

  useEffect(() => {
    if (semestres.length && !semestres.some((s) => s.id === semesterId)) {
      setSemesterId(semestres[0].id);
    }
  }, [semestres, semesterId]);

  const charger = async () => {
    if (!classroomId || !semesterId) return;
    const reponse = await chargerEvaluations({ semesterId });
    setEvaluations(
      reponse.assessments.filter((e) => e.classroomId === classroomId)
    );
  };

  useEffect(() => {
    charger().catch((e) => setErreur((e as Error).message));
  }, [classroomId, semesterId]);

  const agir = async (evaluation: Evaluation, vers: StatutEvaluation) => {
    setMessage(null);
    setErreur(null);
    try {
      const reponse = await changerStatutEvaluation(evaluation.id, vers);
      setMessage(
        `« ${evaluation.title} » : ${LIBELLES_STATUT_EVALUATION[evaluation.status]} → ${
          LIBELLES_STATUT_EVALUATION[reponse.assessment.status]
        }`
      );
      await charger();
    } catch (e) {
      setErreur((e as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Vérification des saisies</h1>
        <p className="text-sm text-muted-foreground">
          Workflow brouillon → saisie → à vérifier → validée → publiée. Une évaluation validée ne
          peut plus être modifiée sans repasser en « à vérifier ».
        </p>
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
      </div>

      {message ? <p className="text-sm text-secondary">{message}</p> : null}
      {erreur ? <p className="text-sm text-destructive">{erreur}</p> : null}
      {!peutValider ? (
        <p className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          Votre rôle permet de saisir et d'envoyer à vérifier. Seuls l'administrateur de
          l'établissement et le surveillant général peuvent valider ou publier.
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="p-3 text-left">Discipline</th>
              <th className="p-3 text-left">Évaluation</th>
              <th className="p-3 text-left">Statut</th>
              <th className="p-3 text-right">Notes</th>
              <th className="p-3 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {evaluations.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-3 text-muted-foreground">
                  Aucune évaluation pour cette classe et ce semestre.
                </td>
              </tr>
            ) : (
              evaluations.map((evaluation) => (
                <tr key={evaluation.id} className="border-t border-border">
                  <td className="p-3">{evaluation.subjectName}</td>
                  <td className="p-3">
                    {evaluation.position}. {evaluation.title}
                    <span className="ml-2 text-xs text-muted-foreground">
                      /{evaluation.outOf}
                    </span>
                  </td>
                  <td className="p-3">
                    <span className={`rounded-full px-2 py-1 text-xs ${statutClasses(evaluation.status)}`}>
                      {LIBELLES_STATUT_EVALUATION[evaluation.status]}
                    </span>
                  </td>
                  <td className="p-3 text-right">{evaluation.notesSaisies}</td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-2">
                      {TRANSITIONS[evaluation.status].map((transition) => {
                        const interdit = transition.exigeDroits && !peutValider;
                        return (
                          <Button
                            key={transition.vers}
                            size="sm"
                            variant="outline"
                            disabled={interdit}
                            title={
                              interdit
                                ? 'Réservé à l\'administrateur et au surveillant général'
                                : undefined
                            }
                            onClick={() => agir(evaluation, transition.vers)}
                          >
                            {transition.label}
                          </Button>
                        );
                      })}
                      <Button size="sm" variant="ghost" asChild>
                        <Link to="/saisie-notes">Saisir</Link>
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
