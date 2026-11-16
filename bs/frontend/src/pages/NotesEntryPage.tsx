import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NotesSheet, cleCellule } from '@/components/NotesSheet';
import {
  ErreurSaisie,
  chargerAffectations,
  chargerAnnees,
  chargerClasses,
  chargerFeuille,
  chargerTypes,
  creerEvaluation,
  enregistrerNotes,
  type Affectation,
  type CelluleFeuille,
  type Classe,
  type FeuilleSaisie,
  type LigneFeuille,
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

  const [affectations, setAffectations] = useState<Affectation[]>([]);
  const [feuille, setFeuille] = useState<FeuilleSaisie | null>(null);

  const [modifiees, setModifiees] = useState<Record<string, CelluleFeuille>>({});
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

  const rechargerFeuille = useCallback(async () => {
    if (!affectationId || !semesterId) {
      setFeuille(null);
      return;
    }
    const reponse = await chargerFeuille({
      classroomSubjectId: affectationId,
      semesterId,
    });
    setFeuille(reponse);
  }, [affectationId, semesterId]);

  useEffect(() => {
    setModifiees({});
    setErreurs({});
    setMessage(null);
    rechargerFeuille().catch((erreur) => setErreurGlobale((erreur as Error).message));
  }, [rechargerFeuille]);

  const lignesAffichees: LigneFeuille[] = feuille
    ? feuille.lignes.map((ligne) => ({
        ...ligne,
        notes: ligne.notes.map(
          (note) => modifiees[cleCellule(note.assessmentId, ligne.enrollmentId)] ?? note
        ),
      }))
    : [];

  const nbModifiees = Object.keys(modifiees).length;
  const colonnesVerrouillees = feuille?.colonnes.filter((c) => !c.saisieAutorisee).length ?? 0;
  const colonnesNonValidees =
    feuille?.colonnes.filter((c) => c.status !== 'VALIDEE' && c.status !== 'PUBLIEE').length ?? 0;

  const surChangementCellule = (
    assessmentId: string,
    enrollmentId: string,
    patch: Partial<CelluleFeuille>
  ) => {
    const ligne = feuille?.lignes.find((l) => l.enrollmentId === enrollmentId);
    const brute = ligne?.notes.find((n) => n.assessmentId === assessmentId);
    if (!brute) return;
    const cle = cleCellule(assessmentId, enrollmentId);
    const suivante: CelluleFeuille = { ...(modifiees[cle] ?? brute), ...patch };

    setModifiees((etat) => {
      const copie = { ...etat };
      const identique =
        (suivante.score ?? '') === (brute.score ?? '') &&
        suivante.status === brute.status &&
        (suivante.observation ?? '') === (brute.observation ?? '');
      if (identique) delete copie[cle];
      else copie[cle] = suivante;
      return copie;
    });

    setErreurs((etat) => {
      if (!etat[cle]) return etat;
      const copie = { ...etat };
      delete copie[cle];
      return copie;
    });
  };

  const enregistrer = async () => {
    if (nbModifiees === 0) return;
    setEnCours(true);
    setErreurGlobale(null);
    setErreurs({});
    setMessage(null);

    const groupes = new Map<
      string,
      { enrollmentId: string; score: string | null; status: CelluleFeuille['status']; observation: string | null }[]
    >();
    for (const [cle, cellule] of Object.entries(modifiees)) {
      const enrollmentId = cle.split(':')[1] ?? '';
      const liste = groupes.get(cellule.assessmentId) ?? [];
      liste.push({
        enrollmentId,
        score: cellule.status === 'SAISIE' ? cellule.score || null : null,
        status: cellule.status,
        observation: cellule.observation || null,
      });
      groupes.set(cellule.assessmentId, liste);
    }

    const reussies: string[] = [];
    const evaluationsReussies = new Set<string>();
    const echecs: string[] = [];
    for (const [assessmentId, notes] of groupes) {
      try {
        const reponse = await enregistrerNotes(assessmentId, notes);
        reussies.push(reponse.indicateur);
        evaluationsReussies.add(assessmentId);
      } catch (erreur) {
        if (erreur instanceof ErreurSaisie) {
          setErreurs((etat) => {
            const copie = { ...etat };
            for (const une of erreur.erreurs) {
              copie[cleCellule(assessmentId, une.enrollmentId)] = une.message;
            }
            return copie;
          });
          echecs.push(`${erreur.message} (${erreur.erreurs.length} ligne(s) en cause)`);
        } else {
          echecs.push((erreur as Error).message);
        }
      }
    }

    if (evaluationsReussies.size > 0) {
      setModifiees((etat) => {
        const copie = { ...etat };
        for (const cle of Object.keys(copie)) {
          if (evaluationsReussies.has(cle.split(':')[0])) delete copie[cle];
        }
        return copie;
      });
    }

    if (echecs.length === 0) {
      setMessage(reussies.join(' · '));
    } else {
      setErreurGlobale(
        `${echecs.join(' · ')}. ${
          reussies.length > 0
            ? 'Les autres évaluations ont été enregistrées.'
            : "Rien n'a été enregistré pour ces évaluations."
        }`
      );
      if (reussies.length > 0) setMessage(reussies.join(' · '));
    }

    try {
      await rechargerFeuille();
    } catch (erreur) {
      setErreurGlobale((erreur as Error).message);
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
      await rechargerFeuille();
      setMessage(`Évaluation « ${reponse.assessment.title} » créée en brouillon`);
    } catch (erreur) {
      setErreurGlobale((erreur as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-brand-navy">Saisie des notes</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Feuille consolidée par discipline. Les moyennes et appréciations sont calculées côté
          serveur, y compris pour les évaluations non validées.
        </p>
      </header>

      <Card className="gap-0 border-border py-0 shadow-sm">
        <CardContent className="grid gap-4 p-4 md:grid-cols-3">
          <label className="text-sm">
            <span className="text-muted-foreground">Classe</span>
            <select
              className="mt-1 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/20"
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
              className="mt-1 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/20"
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
              className="mt-1 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/20"
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
        </CardContent>
      </Card>

      <Card className="gap-0 border-border py-0 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Créer une évaluation</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="text-muted-foreground">Nouvelle évaluation</span>
            <Input
              className="mt-1 h-11 w-56"
              placeholder="Titre (ex. Devoir 1)"
              value={nouveauTitre}
              onChange={(event) => setNouveauTitre(event.target.value)}
            />
          </label>
          <label className="text-sm">
            <span className="text-muted-foreground">Type</span>
            <select
              className="mt-1 block h-11 rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/20"
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
        </CardContent>
      </Card>

      {!feuille ? (
        <p className="text-sm text-muted-foreground">
          Choisissez une classe, un semestre et une discipline (ou créez une évaluation).
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card px-4 py-3">
            <div className="text-sm text-foreground">
              <p>
                <span className="font-medium">{feuille.classroomSubject.subject.name}</span> —{' '}
                {feuille.classroomSubject.classroom.name} · {feuille.semester.name} · coef.{' '}
                {feuille.classroomSubject.coefficient ?? '—'}
              </p>
              <p className="text-xs text-muted-foreground">
                {feuille.colonnes.length} évaluation(s) · {colonnesNonValidees} non validée(s) ·{' '}
                {colonnesVerrouillees} verrouillée(s)
              </p>
            </div>
            <div className="flex items-center gap-3">
              <p className="text-sm text-muted-foreground">
                {nbModifiees > 0
                  ? `${nbModifiees} note(s) non enregistrée(s)`
                  : 'Toutes les notes sont enregistrées'}
              </p>
              <Button onClick={enregistrer} disabled={enCours || nbModifiees === 0}>
                {enCours ? 'Enregistrement...' : 'Enregistrer'}
              </Button>
            </div>
          </div>

          <p className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
            Les évaluations non validées sont incluses dans la moyenne prévisualisée. Les colonnes
            validées ou publiées restent visibles mais verrouillées.
          </p>

          {message ? (
            <p role="status" className="rounded-lg border border-primary/25 bg-primary/5 px-4 py-3 text-sm text-primary">
              {message}
            </p>
          ) : null}
          {erreurGlobale ? (
            <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {erreurGlobale}
            </p>
          ) : null}

          <NotesSheet
            colonnes={feuille.colonnes}
            lignes={lignesAffichees}
            errors={erreurs}
            onChangeCell={surChangementCellule}
          />
          <p className="text-xs text-muted-foreground">
            Entrée ou ↓ : élève suivant dans la même évaluation · ↑ : élève précédent · Tab :
            parcours naturel. La moyenne et l&apos;appréciation sont calculées côté serveur.
          </p>
        </>
      )}
    </div>
  );
}
