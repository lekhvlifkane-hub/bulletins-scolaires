import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { BookOpenCheck, Clock3, Pencil, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';

type AcademicYear = { id: string; name: string; status: 'PREPARATION' | 'ACTIVE' | 'CLOSED' };
type Classroom = {
  id: string;
  name: string;
  academicYear: AcademicYear;
  level: { name: string };
  series: { name: string } | null;
};
type Subject = { id: string; name: string; code: string };
type ClassroomSubject = {
  id: string;
  coefficient: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  subject: Subject;
  classroom: Classroom;
};

const inputClass =
  'h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-800 outline-none transition focus:border-emerald-600 focus:ring-4 focus:ring-emerald-600/10';

async function lireReponse<T>(response: Response, fallback: string): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof body.error === 'string' ? body.error : fallback);
  }
  return body as T;
}

export function DisciplinesPage() {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [assignments, setAssignments] = useState<ClassroomSubject[]>([]);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [classroomId, setClassroomId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [coefficient, setCoefficient] = useState('1');
  const [editingAssignmentId, setEditingAssignmentId] = useState<string | null>(null);
  const [editedCoefficient, setEditedCoefficient] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadPage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [subjectsResponse, classesResponse, assignmentsResponse] = await Promise.all([
        api.fetch('/api/schooling/subjects'),
        api.fetch('/api/schooling/classes'),
        api.fetch('/api/schooling/classroom-subjects'),
      ]);
      const [subjectsData, classesData, assignmentsData] = await Promise.all([
        lireReponse<{ subjects: Subject[] }>(subjectsResponse, 'Impossible de charger les disciplines'),
        lireReponse<{ classes: Classroom[] }>(classesResponse, 'Impossible de charger les classes'),
        lireReponse<{ classroomSubjects: ClassroomSubject[] }>(
          assignmentsResponse,
          'Impossible de charger les affectations',
        ),
      ]);
      setSubjects(subjectsData.subjects);
      setClassrooms(classesData.classes);
      setAssignments(assignmentsData.classroomSubjects);
      setClassroomId((current) =>
        current && classesData.classes.some((classroom) => classroom.id === current)
          ? current
          : classesData.classes.find((classroom) => classroom.academicYear.status === 'ACTIVE')?.id ??
            classesData.classes.find((classroom) => classroom.academicYear.status !== 'CLOSED')?.id ??
            '',
      );
      setSubjectId((current) =>
        current && subjectsData.subjects.some((subject) => subject.id === current)
          ? current
          : subjectsData.subjects[0]?.id ?? '',
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Impossible de charger les disciplines');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPage();
  }, [loadPage]);

  const createSubject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setSaving(true);
    try {
      const response = await api.fetch('/api/schooling/subjects', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), code: code.trim() }),
      });
      const body = await lireReponse<{ subject: Subject }>(response, 'Impossible de créer la discipline');
      setName('');
      setCode('');
      setSubjectId(body.subject.id);
      setMessage(`La discipline « ${body.subject.name} » a été ajoutée.`);
      await loadPage();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Impossible de créer la discipline');
    } finally {
      setSaving(false);
    }
  };

  const assignSubject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setSaving(true);
    try {
      const response = await api.fetch('/api/schooling/classroom-subjects', {
        method: 'POST',
        body: JSON.stringify({ classroomId, subjectId, coefficient }),
      });
      await lireReponse<{ classroomSubject: ClassroomSubject }>(
        response,
        'Impossible d’affecter la discipline à la classe',
      );
      setMessage('Discipline affectée à la classe avec le coefficient indiqué.');
      await loadPage();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Impossible d’affecter la discipline');
    } finally {
      setSaving(false);
    }
  };

  const updateCoefficient = async (event: FormEvent<HTMLFormElement>, assignment: ClassroomSubject) => {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setSaving(true);
    try {
      const response = await api.fetch(
        `/api/schooling/classroom-subjects/${assignment.id}/coefficient`,
        {
          method: 'PATCH',
          body: JSON.stringify({ coefficient: editedCoefficient }),
        },
      );
      await lireReponse<{ classroomSubject: ClassroomSubject }>(
        response,
        'Impossible de modifier le coefficient',
      );
      setEditingAssignmentId(null);
      setMessage(
        `Coefficient de ${assignment.subject.name} modifié. L’ancien coefficient est conservé dans l’historique.`,
      );
      await loadPage();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Impossible de modifier le coefficient');
    } finally {
      setSaving(false);
    }
  };

  const activeAssignments = assignments.filter((assignment) => assignment.effectiveTo === null);
  const historicalAssignments = assignments.filter((assignment) => assignment.effectiveTo !== null);
  const classAssignments = activeAssignments.filter((assignment) => assignment.classroom.id === classroomId);
  const availableSubjects = subjects.filter(
    (subject) => !classAssignments.some((assignment) => assignment.subject.id === subject.id),
  );
  const openClassrooms = classrooms.filter((classroom) => classroom.academicYear.status !== 'CLOSED');

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm font-semibold text-emerald-700">Pédagogie</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Disciplines et coefficients</h1>
        <p className="mt-2 text-sm text-slate-500">
          Créez le catalogue des disciplines et affectez-les aux classes avec leurs coefficients.
        </p>
      </header>

      {error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {message && <p role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</p>}

      <section className="grid gap-5 xl:grid-cols-2">
        <article className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-7">
          <div className="mb-5 flex items-center gap-2">
            <BookOpenCheck aria-hidden="true" className="h-5 w-5 text-emerald-700" />
            <h2 className="text-base font-bold text-slate-800">Catalogue des disciplines</h2>
          </div>
          <form onSubmit={createSubject} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <label className="space-y-1.5 text-xs font-semibold text-slate-600">
              Nom
              <input
                className={inputClass}
                aria-label="Nom de la discipline"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Ex. Mathématiques"
                required
                maxLength={100}
              />
            </label>
            <label className="space-y-1.5 text-xs font-semibold text-slate-600">
              Code
              <input
                className={inputClass}
                aria-label="Code de la discipline"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="Ex. MATH"
                required
                maxLength={30}
              />
            </label>
            <Button type="submit" className="self-end" disabled={saving}>
              <Plus aria-hidden="true" className="h-4 w-4" />
              Ajouter
            </Button>
          </form>
          {loading ? (
            <p role="status" className="mt-5 text-sm text-slate-500">Chargement des disciplines…</p>
          ) : subjects.length === 0 ? (
            <p className="mt-5 text-sm text-slate-500">Aucune discipline configurée.</p>
          ) : (
            <ul className="mt-5 flex flex-wrap gap-2">
              {subjects.map((subject) => (
                <li key={subject.id} className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700">
                  {subject.name} · {subject.code}
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-7">
          <div className="mb-5 flex items-center gap-2">
            <BookOpenCheck aria-hidden="true" className="h-5 w-5 text-violet-700" />
            <h2 className="text-base font-bold text-slate-800">Affecter à une classe</h2>
          </div>
          {loading ? (
            <p role="status" className="text-sm text-slate-500">Chargement des classes…</p>
          ) : subjects.length === 0 || openClassrooms.length === 0 ? (
            <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {subjects.length === 0
                ? 'Ajoutez d’abord une discipline au catalogue.'
                : 'Créez une classe dans une année scolaire non clôturée.'}
            </p>
          ) : (
            <form onSubmit={assignSubject} className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1.5 text-xs font-semibold text-slate-600">
                Classe
                <select
                  className={inputClass}
                  aria-label="Classe"
                  value={classroomId}
                  onChange={(event) => setClassroomId(event.target.value)}
                  required
                >
                  {openClassrooms.map((classroom) => (
                    <option key={classroom.id} value={classroom.id}>
                      {classroom.name} · {classroom.level.name} · {classroom.academicYear.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1.5 text-xs font-semibold text-slate-600">
                Discipline
                <select
                  className={inputClass}
                  aria-label="Discipline à affecter"
                  value={availableSubjects.some((subject) => subject.id === subjectId) ? subjectId : availableSubjects[0]?.id ?? ''}
                  onChange={(event) => setSubjectId(event.target.value)}
                  required
                  disabled={availableSubjects.length === 0}
                >
                  {availableSubjects.map((subject) => (
                    <option key={subject.id} value={subject.id}>{subject.name}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1.5 text-xs font-semibold text-slate-600">
                Coefficient
                <input
                  className={inputClass}
                  aria-label="Coefficient"
                  type="number"
                  min="0"
                  step="0.01"
                  value={coefficient}
                  onChange={(event) => setCoefficient(event.target.value)}
                  required
                />
              </label>
              <div className="self-end">
                <Button type="submit" disabled={saving || !availableSubjects.length || !classroomId}>
                  {saving ? 'Enregistrement…' : 'Affecter la discipline'}
                </Button>
              </div>
              {availableSubjects.length === 0 && (
                <p className="text-sm text-slate-500 sm:col-span-2">
                  Toutes les disciplines sont déjà affectées à cette classe.
                </p>
              )}
            </form>
          )}
        </article>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4 sm:px-7">
          <h2 className="font-bold text-slate-800">Disciplines affectées</h2>
        </div>
        {loading ? (
          <p role="status" className="p-6 text-sm text-slate-500">Chargement des affectations…</p>
        ) : activeAssignments.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">Aucune discipline n’est encore affectée à une classe.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">Classe</th>
                  <th className="px-5 py-3">Niveau / série</th>
                  <th className="px-5 py-3">Année scolaire</th>
                  <th className="px-5 py-3">Discipline</th>
                  <th className="px-5 py-3">Coefficient</th>
                  <th className="px-5 py-3">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {activeAssignments.map((assignment) => (
                  <tr key={assignment.id}>
                    <td className="px-5 py-3 font-semibold text-slate-800">{assignment.classroom.name}</td>
                    <td className="px-5 py-3 text-slate-600">
                      {assignment.classroom.level.name}
                      {assignment.classroom.series ? ` · ${assignment.classroom.series.name}` : ''}
                    </td>
                    <td className="px-5 py-3 text-slate-600">{assignment.classroom.academicYear.name}</td>
                    <td className="px-5 py-3 text-slate-600">{assignment.subject.name}</td>
                    <td className="px-5 py-3 font-semibold text-slate-800">
                      {editingAssignmentId === assignment.id ? (
                        <form
                          className="flex items-center gap-2"
                          onSubmit={(event) => void updateCoefficient(event, assignment)}
                        >
                          <input
                            className={`${inputClass} h-9 w-24`}
                            aria-label={`Nouveau coefficient ${assignment.subject.name} ${assignment.classroom.name}`}
                            type="number"
                            min="0"
                            max="9999.99"
                            step="0.01"
                            value={editedCoefficient}
                            onChange={(event) => setEditedCoefficient(event.target.value)}
                            required
                          />
                          <Button type="submit" size="sm" disabled={saving}>
                            Enregistrer
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={saving}
                            onClick={() => setEditingAssignmentId(null)}
                          >
                            Annuler
                          </Button>
                        </form>
                      ) : (
                        assignment.coefficient
                      )}
                    </td>
                    <td className="px-5 py-3">
                      {editingAssignmentId !== assignment.id && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={saving}
                          onClick={() => {
                            setEditingAssignmentId(assignment.id);
                            setEditedCoefficient(assignment.coefficient);
                          }}
                        >
                          <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
                          Modifier
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {historicalAssignments.length > 0 && (
        <details className="rounded-2xl border border-slate-200/80 bg-white shadow-sm">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-4 font-bold text-slate-800 sm:px-7">
            <Clock3 aria-hidden="true" className="h-4 w-4 text-slate-500" />
            Historique des coefficients ({historicalAssignments.length})
          </summary>
          <div className="overflow-x-auto border-t border-slate-100">
            <table className="w-full min-w-[600px] text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">Classe</th>
                  <th className="px-5 py-3">Discipline</th>
                  <th className="px-5 py-3">Coefficient</th>
                  <th className="px-5 py-3">Valable du</th>
                  <th className="px-5 py-3">Jusqu’au</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {historicalAssignments.map((assignment) => (
                  <tr key={assignment.id}>
                    <td className="px-5 py-3">{assignment.classroom.name}</td>
                    <td className="px-5 py-3">{assignment.subject.name}</td>
                    <td className="px-5 py-3">{assignment.coefficient}</td>
                    <td className="px-5 py-3">
                      {new Date(assignment.effectiveFrom).toLocaleDateString('fr-FR')}
                    </td>
                    <td className="px-5 py-3">
                      {assignment.effectiveTo
                        ? new Date(assignment.effectiveTo).toLocaleDateString('fr-FR')
                        : 'En cours'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}
