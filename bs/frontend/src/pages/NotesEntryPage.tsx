import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { NotesGrid } from '@/components/NotesGrid';
import {
  ErreurSaisie,
  LIBELLES_STATUT_EVALUATION,
  chargerAffectations,
  chargerAnnees,
  chargerClasses,
  chargerEvaluations,
  chargerGrille,
  chargerTypes,
  creerEvaluation,
  enregistrerNotes,
  type Affectation,
  type Classe,
  type Evaluation,
  type LigneNote,
  type TypeEvaluation,
  type YearSemestre,
} from '@/lib/notes';

export function NotesEntryPage() {
  const [classes, setClasses] = useState<Classe[]>([]);
  const [annees, setAnnees] = useState<YearSemestre[]>([]);
  const [types, setTypes] = useState<TypeEvaluation[]>([]);

  const [classroomId, setClassroomId] = useState('');
  const [semesterId, setSemesterId] = useState('');
  const [affectationId, setAffectationId] = useState('');
  const [assessmentId, setAssessmentId] = useState('');

  const [affectations, setAffectations] = useState<Affectation[]>([]);
  const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
  const [grille, setGrille] = useState<{ lignes: LigneNote[]; bareme: string; saisieAutorisee: boolean; statut: string; titre: string } | null>(null);

  const [modifiees, setModifiees] = useState<Record<string, LigneNote>>({});
  const [erreurs, setErreurs] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [erreurGlobale, setErreurGlobale] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  const [nouveauTitre, setNouveauTitre] = useState('');
  const [nouveauType, setNouveauType] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [reponseClasses, reponseAnnees, reponseTypes] = await Promise.all([
          chargerClasses(),
          chargerAnnees(),
          chargerTypes(),
        ]);
        setClasses(reponseClasses.classes);
        setAnnees(reponseAnnees.years);
        setTypes(reponseTypes.types);
        if (reponseTypes.types[0]) setNouveauType(reponseTypes.types[0].id);
        if (reponseClasses.classes[0]) setClassroomId(reponseClasses.classes[0].id);
      } catch (erreur) {
        setErreurGlobale((erreur as Error).message);
      }
    })();
  }, []);

  const classe = classes.find((c) => c.id === classroomId) ?? null;
  const semestres = useMemo(
    () => annees.find((a) => a.id === classe?.academicYear.id)?.semesters ?? [],
    [annees, classe]
  );

  useEffect(() => {
    if (!classroomId) return;
    (async () => {
      const reponse = await chargerAffectations(classroomId);
      setAffectations(reponse.classroomSubjects);
      setAffectationId(reponse.classroomSubjects[0]?.id ?? '');
    })().catch((erreur) => setErreurGlobale((erreur as Error).message));
  }, [classroomId]);

  useEffect(() => {
    if (semestres.length > 0 && !semestres.some((s) => s.id === semesterId)) {
      setSemesterId(semestres[0].id);
    }
  }, [semestres, semesterId]);

  const rechargerEvaluations = useCallback(async () => {
    if (!affectationId || !semesterId) {
      setEvaluations([]);
      setAssessmentId('');
      return;
    }
    const reponse = await chargerEvaluations({ classroomSubjectId: affectationId, semesterId });
    setEvaluations(reponse.assessments);
    setAssessmentId((actuel) =>
      reponse.assessments.some((e) => e.id === actuel)
        ? actuel
        : reponse.assessments[0]?.id ?? ''
    );
  }, [affectationId, semesterId]);

  useEffect(() => {
    rechargerEvaluations().catch((erreur) => setErreurGlobale((erreur as Error).message));
  }, [rechargerEvaluations]);

  useEffect(() => {
    if (!assessmentId) {
      setGrille(null);
      return;
    }
    setModifiees({});
    setErreurs({});
    setMessage(null);
    (async () => {
      const reponse = await chargerGrille(assessmentId);
      setGrille({
        lignes: reponse.lignes,
        bareme: reponse.assessment.outOf,
        saisieAutorisee: reponse.assessment.saisieAutorisee,
        statut: reponse.assessment.status,
        titre: reponse.assessment.title,
      });
    })().catch((erreur) => setErreurGlobale((erreur as Error).message));
  }, [assessmentId]);

  const lignesAffichees = grille
    ? grille.lignes.map((ligne) => modifiees[ligne.enrollmentId] ?? ligne)
    : [];

  const nbModifiees = Object.keys(modifiees).length;

  const surChangementLigne = (enrollmentId: string, patch: Partial<LigneNote>) => {
    const brute = grille?.lignes.find((l) => l.enrollmentId === enrollmentId);
    if (!brute) return;
    const affichee = modifiees[enrollmentId] ?? brute;
    const suivante: LigneNote = { ...affichee, ...patch };

    setModifiees((etat) => {
      const copie = { ...etat };
      const identique =
        suivante.score === brute.score &&
        suivante.status === brute.status &&
        (suivante.observation ?? '') === (brute.observation ?? '');
      if (identique) delete copie[enrollmentId];
      else copie[enrollmentId] = suivante;
      return copie;
    });

    setErreurs((etat) => {
      if (!etat[enrollmentId]) return etat;
      const copie = { ...etat };
      delete copie[enrollmentId];
      return copie;
    });
  };

  const enregistrer = async () => {
    if (!assessmentId || nbModifiees === 0) return;
    setEnCours(true);
    setErreurGlobale(null);
    setErreurs({});
    setMessage(null);
    try {
      const notes = Object.values(modifiees).map((ligne) => ({
        enrollmentId: ligne.enrollmentId,
        score: ligne.status === 'SAISIE' ? ligne.score || null : null,
        status: ligne.status,
        observation: ligne.observation || null,
      }));
      const reponse = await enregistrerNotes(assessmentId, notes);
      setModifiees({});
      setMessage(reponse.indicateur);
      const fraiche = await chargerGrille(assessmentId);
      setGrille((actuelle) =>
        actuelle
          ? {
              ...actuelle,
              lignes: fraiche.lignes,
              saisieAutorisee: fraiche.assessment.saisieAutorisee,
              statut: fraiche.assessment.status,
            }
          : actuelle
      );
    } catch (erreur) {
      if (erreur instanceof ErreurSaisie) {
        const parEleve: Record<string, string> = {};
        for (const une of erreur.erreurs) parEleve[une.enrollmentId] = une.message;
        setErreurs(parEleve);
        setErreurGlobale(
          `${erreur.message} — ${erreur.erreurs.length} ligne(s) en cause. Rien n'a été enregistré.`
        );
      } else {
        setErreurGlobale((erreur as Error).message);
      }
    } finally {
      setEnCours(false);
    }
  };

  const creer = async () => {
    if (!affectationId || !semesterId || !nouveauTitre || !nouveauType) {
      setErreurGlobale('Titre et type d\'évaluation requis');
      return;
    }
    setErreurGlobale(null);
    try {
      const reponse = await creerEvaluation({
        classroomSubjectId: affectationId,
        semesterId,
        typeId: nouveauType,
        title: nouveauTitre,
      });
      setNouveauTitre('');
      await rechargerEvaluations();
      setAssessmentId(reponse.assessment.id);
      setMessage(`Évaluation « ${reponse.assessment.title} » créée en brouillon`);
    } catch (erreur) {
      setErreurGlobale((erreur as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Saisie des notes</h1>
        <p className="text-sm text-muted-foreground">
          Grille clavier, enregistrement explicite. Les moyennes ne sont jamais calculées ici.
        </p>
      </div>

      <div className="grid gap-3 rounded-lg border border-border p-4 md:grid-cols-4">
        <label className="text-sm">
          <span className="text-muted-foreground">Classe</span>
          <select
            className="mt-1 w-full rounded-md border border-input px-2 py-2 text-sm"
            value={classroomId}
            onChange={(event) => setClassroomId(event.target.value)}
          >
            {classes.length === 0 ? <option value="">Aucune classe</option> : null}
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} — {c.academicYear.name} ({c._count.enrollments} élèves)
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          <span className="text-muted-foreground">Semestre</span>
          <select
            className="mt-1 w-full rounded-md border border-input px-2 py-2 text-sm"
            value={semesterId}
            onChange={(event) => setSemesterId(event.target.value)}
          >
            {semestres.length === 0 ? <option value="">Aucun semestre</option> : null}
            {semestres.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          <span className="text-muted-foreground">Discipline</span>
          <select
            className="mt-1 w-full rounded-md border border-input px-2 py-2 text-sm"
            value={affectationId}
            onChange={(event) => setAffectationId(event.target.value)}
          >
            {affectations.length === 0 ? <option value="">Aucune discipline affectée</option> : null}
            {affectations.map((a) => (
              <option key={a.id} value={a.id}>
                {a.subject.name} (coef. {a.coefficient})
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          <span className="text-muted-foreground">Évaluation</span>
          <select
            className="mt-1 w-full rounded-md border border-input px-2 py-2 text-sm"
            value={assessmentId}
            onChange={(event) => setAssessmentId(event.target.value)}
          >
            {evaluations.length === 0 ? <option value="">Aucune évaluation</option> : null}
            {evaluations.map((e) => (
              <option key={e.id} value={e.id}>
                {e.position}. {e.title} — {LIBELLES_STATUT_EVALUATION[e.status]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-dashed border-border p-4">
        <label className="text-sm">
          <span className="text-muted-foreground">Nouvelle évaluation</span>
          <input
            className="mt-1 block w-56 rounded-md border border-input px-2 py-2 text-sm"
            placeholder="Titre (ex. Devoir 1)"
            value={nouveauTitre}
            onChange={(event) => setNouveauTitre(event.target.value)}
          />
        </label>
        <label className="text-sm">
          <span className="text-muted-foreground">Type</span>
          <select
            className="mt-1 block rounded-md border border-input px-2 py-2 text-sm"
            value={nouveauType}
            onChange={(event) => setNouveauType(event.target.value)}
          >
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.category})
              </option>
            ))}
          </select>
        </label>
        <Button variant="outline" onClick={creer}>
          Créer
        </Button>
      </div>

      {!grille ? (
        <p className="text-sm text-muted-foreground">
          Choisissez une classe, un semestre, une discipline puis une évaluation (ou créez-en une).
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">
              <span className="font-medium">{grille.titre}</span> — barème {grille.bareme} —{' '}
              {LIBELLES_STATUT_EVALUATION[grille.statut as keyof typeof LIBELLES_STATUT_EVALUATION]}
            </p>
            <div className="flex items-center gap-3">
              <p className="text-sm text-muted-foreground">
                {nbModifiees > 0
                  ? `${nbModifiees} ligne(s) non enregistrée(s)`
                  : 'Toutes les lignes sont enregistrées'}
              </p>
              <Button onClick={enregistrer} disabled={enCours || nbModifiees === 0 || !grille.saisieAutorisee}>
                {enCours ? 'Enregistrement...' : 'Enregistrer'}
              </Button>
            </div>
          </div>

          {!grille.saisieAutorisee ? (
            <p className="rounded-md border border-accent bg-accent/10 p-3 text-sm">
              Saisie fermée : cette évaluation est « {grille.statut.toLowerCase()} ». Un surveillant
              général ou l'administrateur doit la ramener en « À vérifier » pour corriger.
            </p>
          ) : null}

          {message ? <p className="text-sm text-secondary">{message}</p> : null}
          {erreurGlobale ? <p className="text-sm text-destructive">{erreurGlobale}</p> : null}

          <NotesGrid
            lignes={lignesAffichees}
            barame={grille.bareme}
            modifiable={grille.saisieAutorisee}
            errors={erreurs}
            onChangeLine={surChangementLigne}
          />
          <p className="text-xs text-muted-foreground">
            Entrée ou ↓ : ligne suivante dans la même colonne · ↑ : ligne précédente · Tab : colonne
            suivante.
          </p>
        </>
      )}
    </div>
  );
}
