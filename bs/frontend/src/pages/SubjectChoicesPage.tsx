import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { api } from '@/lib/api';
import { chargerClasses, type Classe } from '@/lib/notes';

type Option = { id: string; name: string; code: string };
type Choice = { enrollmentId: string; subjectId: string };
type StudentEnrollment = {
  id: string;
  classroomId: string;
  status: string;
};
type Student = {
  id: string;
  matricule: string;
  lastName: string;
  firstNames: string;
  enrollments: StudentEnrollment[];
};

async function lireReponse<T>(response: Response, fallback: string): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof body.error === 'string' ? body.error : fallback);
  }
  return body as T;
}

export function SubjectChoicesPage() {
  const [classes, setClasses] = useState<Classe[]>([]);
  const [classroomId, setClassroomId] = useState('');
  const [students, setStudents] = useState<Student[]>([]);
  const [options, setOptions] = useState<Option[]>([]);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([chargerClasses(), api.fetch('/api/students'), api.fetch('/api/schooling/subject-choices')])
      .then(async ([classesData, studentsResponse, choicesResponse]) => {
        const studentsData = await lireReponse<{ students: Student[] }>(studentsResponse, 'Chargement des élèves impossible');
        const choicesData = await lireReponse<{ choices: Choice[]; options: Option[] }>(
          choicesResponse,
          'Chargement des choix impossible'
        );
        setClasses(classesData.classes);
        setStudents(studentsData.students);
        setOptions(choicesData.options.filter((option) => !option.code.endsWith('_LV2')));
        setChoices(Object.fromEntries(choicesData.choices.map((choice) => [choice.enrollmentId, choice.subjectId])));
        setClassroomId(
          classesData.classes.find((classe) => classe.level?.name === '4e')?.id ??
            classesData.classes[0]?.id ??
            ''
        );
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Chargement impossible'))
      .finally(() => setLoading(false));
  }, []);

  const eleves = useMemo(
    () =>
      students
        .map((student) => ({
          student,
          enrollment: student.enrollments.find(
            (enrollment) => enrollment.classroomId === classroomId && enrollment.status === 'ACTIVE'
          ),
        }))
        .filter((item) => item.enrollment !== undefined),
    [students, classroomId]
  );

  const enregistrer = useCallback(async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      let count = 0;
      for (const item of eleves) {
        const subjectId = choices[item.enrollment!.id];
        if (!subjectId) continue;
        const response = await api.fetch('/api/schooling/subject-choices', {
          method: 'PUT',
          body: JSON.stringify({ enrollmentId: item.enrollment!.id, subjectId }),
        });
        await lireReponse(response, 'Enregistrement du choix impossible');
        count += 1;
      }
      setMessage(`${count} choix enregistré(s).`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Enregistrement impossible');
    } finally {
      setSaving(false);
    }
  }, [choices, eleves]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-brand-navy">Choix des matières options</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Sélectionnez la langue vivante 2 des élèves de 4e. La note saisie reste rattachée à la
          discipline « LV2 » : seul le libellé affiché sur le bulletin change.
        </p>
      </header>

      {error ? <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}
      {message ? <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p> : null}

      <Card className="gap-0 border-border py-0 shadow-sm">
        <CardContent className="flex flex-wrap items-end justify-between gap-4 p-4">
          <label className="min-w-64 text-sm">
            <span className="text-muted-foreground">Classe</span>
            <select
              className="mt-1 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"
              value={classroomId}
              onChange={(event) => setClassroomId(event.target.value)}
            >
              {loading ? <option value="">Chargement…</option> : null}
              {!loading && classes.length === 0 ? <option value="">Aucune classe</option> : null}
              {classes.map((classe) => (
                <option key={classe.id} value={classe.id}>
                  {classe.name} — {classe.level?.name ?? 'sans niveau'}
                </option>
              ))}
            </select>
          </label>
          <Button onClick={() => void enregistrer()} disabled={saving || options.length === 0 || eleves.length === 0}>
            {saving ? 'Enregistrement…' : 'Enregistrer les choix'}
          </Button>
        </CardContent>
      </Card>

      {options.length === 0 ? (
        <p className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
          Aucune option disponible. Appliquez d’abord le modèle de matières à une classe de 4e.
        </p>
      ) : eleves.length === 0 ? (
        <p className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
          Aucun élève actif dans cette classe.
        </p>
      ) : (
        <Card className="border-border shadow-sm">
          <CardContent className="divide-y divide-border p-0">
            {eleves.map(({ student, enrollment }) => (
              <label key={student.id} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
                <span>
                  <span className="font-medium">{student.lastName} {student.firstNames}</span>
                  <span className="ml-2 text-muted-foreground">{student.matricule}</span>
                </span>
                <select
                  aria-label={`Option de ${student.lastName} ${student.firstNames}`}
                  className="h-10 rounded-lg border border-input bg-background px-3 text-sm"
                  value={choices[enrollment!.id] ?? ''}
                  onChange={(event) =>
                    setChoices((actuels) => ({ ...actuels, [enrollment!.id]: event.target.value }))
                  }
                >
                  <option value="">Choisir…</option>
                  {options.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
