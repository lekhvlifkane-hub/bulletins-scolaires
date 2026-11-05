import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Archive, ArrowLeftRight, Save } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';

type Enrollment = {
  id: string;
  status: string;
  enrolledAt: string;
  endedAt: string | null;
  classroom: {
    id: string;
    name: string;
    academicYear: { name: string };
  };
};

type Student = {
  id: string;
  matricule: string;
  lastName: string;
  firstNames: string;
  birthDate: string | null;
  birthPlace: string | null;
  sex: string | null;
  address: string | null;
  guardianName: string | null;
  guardianPhone: string | null;
  enrollments: Enrollment[];
};

type Classroom = {
  id: string;
  name: string;
  academicYear: { name: string; status: 'PREPARATION' | 'ACTIVE' | 'CLOSED' };
  level: { name: string };
  series: { name: string } | null;
};

type StudentForm = {
  matricule: string;
  lastName: string;
  firstNames: string;
  birthDate: string;
  birthPlace: string;
  sex: string;
  address: string;
  guardianName: string;
  guardianPhone: string;
};

const emptyForm: StudentForm = {
  matricule: '',
  lastName: '',
  firstNames: '',
  birthDate: '',
  birthPlace: '',
  sex: '',
  address: '',
  guardianName: '',
  guardianPhone: '',
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

function formDepuisStudent(student: Student): StudentForm {
  return {
    matricule: student.matricule,
    lastName: student.lastName,
    firstNames: student.firstNames,
    birthDate: student.birthDate?.slice(0, 10) ?? '',
    birthPlace: student.birthPlace ?? '',
    sex: student.sex ?? '',
    address: student.address ?? '',
    guardianName: student.guardianName ?? '',
    guardianPhone: student.guardianPhone ?? '',
  };
}

export function StudentDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [student, setStudent] = useState<Student | null>(null);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [form, setForm] = useState<StudentForm>(emptyForm);
  const [classroomId, setClassroomId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [studentResponse, classesResponse] = await Promise.all([
        api.fetch(`/api/students/${id}`),
        api.fetch('/api/schooling/classes'),
      ]);
      const [studentData, classesData] = await Promise.all([
        lireReponse<{ student: Student }>(studentResponse, 'Impossible de charger le dossier'),
        lireReponse<{ classes: Classroom[] }>(classesResponse, 'Impossible de charger les classes'),
      ]);
      const targetClasses = classesData.classes.filter(
        (classroom) => classroom.academicYear.status !== 'CLOSED',
      );
      const activeEnrollment = studentData.student.enrollments.find(
        (enrollment) => enrollment.status === 'ACTIVE',
      );
      setStudent(studentData.student);
      setForm(formDepuisStudent(studentData.student));
      setClassrooms(targetClasses);
      setClassroomId((current) =>
        current && targetClasses.some((classroom) => classroom.id === current) &&
        current !== activeEnrollment?.classroom.id
          ? current
          : targetClasses.find((classroom) => classroom.id !== activeEnrollment?.classroom.id)?.id ?? '',
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Impossible de charger le dossier élève');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setSaving(true);
    try {
      const response = await api.fetch(`/api/students/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ ...form, birthDate: form.birthDate || undefined }),
      });
      const body = await lireReponse<{ student: Student }>(response, 'Impossible de modifier le dossier');
      setStudent((current) => current ? { ...current, ...body.student } : body.student);
      setForm(formDepuisStudent({ ...student!, ...body.student }));
      setMessage('Dossier élève mis à jour.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Impossible de modifier le dossier');
    } finally {
      setSaving(false);
    }
  };

  const transfer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!classroomId) return;
    setError(null);
    setMessage(null);
    setSaving(true);
    try {
      const response = await api.fetch(`/api/students/${id}/enrollments`, {
        method: 'POST',
        body: JSON.stringify({ classroomId }),
      });
      const body = await lireReponse<{ message: string }>(response, 'Impossible de transférer l’élève');
      setMessage(body.message);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Impossible de transférer l’élève');
    } finally {
      setSaving(false);
    }
  };

  const archive = async () => {
    if (!window.confirm(`Archiver le dossier de ${student?.lastName} ${student?.firstNames} ?`)) return;
    setError(null);
    setSaving(true);
    try {
      const response = await api.fetch(`/api/students/${id}`, { method: 'DELETE' });
      if (!response.ok) {
        await lireReponse(response, 'Impossible d’archiver l’élève');
      }
      navigate('/eleves', { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Impossible d’archiver l’élève');
      setSaving(false);
    }
  };

  const activeEnrollment = student?.enrollments.find((enrollment) => enrollment.status === 'ACTIVE');
  const targetClasses = classrooms.filter((classroom) => classroom.id !== activeEnrollment?.classroom.id);

  return (
    <div className="space-y-6">
      <Button variant="outline" asChild>
        <Link to="/eleves"><ArrowLeftRight aria-hidden="true" className="h-4 w-4" /> Retour aux élèves</Link>
      </Button>

      {error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {message && <p role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</p>}
      {loading ? (
        <p role="status" className="text-sm text-slate-500">Chargement du dossier élève…</p>
      ) : student ? (
        <>
          <header>
            <p className="text-sm font-semibold text-emerald-700">Dossier élève</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
              {student.lastName} {student.firstNames}
            </h1>
            <p className="mt-1 text-sm text-slate-500">Matricule : {student.matricule}</p>
          </header>

          <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-7">
            <h2 className="mb-5 font-bold text-slate-800">Informations personnelles et responsable</h2>
            <form onSubmit={(event) => void save(event)} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <label className="space-y-1.5 text-xs font-semibold text-slate-600">
                Matricule
                <input className={inputClass} value={form.matricule} required minLength={2}
                  onChange={(event) => setForm({ ...form, matricule: event.target.value })} />
              </label>
              <label className="space-y-1.5 text-xs font-semibold text-slate-600">
                Nom
                <input className={inputClass} value={form.lastName} required minLength={2}
                  onChange={(event) => setForm({ ...form, lastName: event.target.value })} />
              </label>
              <label className="space-y-1.5 text-xs font-semibold text-slate-600">
                Prénoms
                <input className={inputClass} value={form.firstNames} required minLength={2}
                  onChange={(event) => setForm({ ...form, firstNames: event.target.value })} />
              </label>
              <label className="space-y-1.5 text-xs font-semibold text-slate-600">
                Date de naissance
                <input className={inputClass} type="date" value={form.birthDate}
                  onChange={(event) => setForm({ ...form, birthDate: event.target.value })} />
              </label>
              <label className="space-y-1.5 text-xs font-semibold text-slate-600">
                Lieu de naissance
                <input className={inputClass} value={form.birthPlace}
                  onChange={(event) => setForm({ ...form, birthPlace: event.target.value })} />
              </label>
              <label className="space-y-1.5 text-xs font-semibold text-slate-600">
                Sexe (facultatif)
                <input className={inputClass} value={form.sex}
                  onChange={(event) => setForm({ ...form, sex: event.target.value })} />
              </label>
              <label className="space-y-1.5 text-xs font-semibold text-slate-600 sm:col-span-2">
                Adresse
                <input className={inputClass} value={form.address}
                  onChange={(event) => setForm({ ...form, address: event.target.value })} />
              </label>
              <label className="space-y-1.5 text-xs font-semibold text-slate-600">
                Parent / tuteur
                <input className={inputClass} value={form.guardianName}
                  onChange={(event) => setForm({ ...form, guardianName: event.target.value })} />
              </label>
              <label className="space-y-1.5 text-xs font-semibold text-slate-600">
                Téléphone du parent / tuteur
                <input className={inputClass} type="tel" value={form.guardianPhone}
                  onChange={(event) => setForm({ ...form, guardianPhone: event.target.value })} />
              </label>
              <div className="self-end">
                <Button type="submit" disabled={saving}>
                  <Save aria-hidden="true" className="h-4 w-4" />
                  Enregistrer les modifications
                </Button>
              </div>
            </form>
          </section>

          <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-7">
            <h2 className="mb-2 font-bold text-slate-800">Transférer vers une autre classe</h2>
            <p className="mb-4 text-sm text-slate-500">
              Le transfert clôt l’inscription active et conserve l’historique scolaire.
            </p>
            {targetClasses.length === 0 ? (
              <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
                Aucune autre classe disponible dans une année non clôturée.
              </p>
            ) : (
              <form onSubmit={(event) => void transfer(event)} className="flex flex-wrap gap-3">
                <label className="min-w-[240px] flex-1 space-y-1.5 text-xs font-semibold text-slate-600">
                  Nouvelle classe
                  <select className={inputClass} value={classroomId} required
                    onChange={(event) => setClassroomId(event.target.value)}>
                    {targetClasses.map((classroom) => (
                      <option key={classroom.id} value={classroom.id}>
                        {classroom.name} · {classroom.level.name}
                        {classroom.series ? ` ${classroom.series.name}` : ''} · {classroom.academicYear.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="self-end">
                  <Button type="submit" disabled={saving || !classroomId}>
                    <ArrowLeftRight aria-hidden="true" className="h-4 w-4" />
                    Transférer l’élève
                  </Button>
                </div>
              </form>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-7">
            <h2 className="mb-4 font-bold text-slate-800">Historique des inscriptions</h2>
            {student.enrollments.length === 0 ? (
              <p className="text-sm text-slate-500">Aucune inscription enregistrée.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {student.enrollments.map((enrollment) => (
                  <li key={enrollment.id} className="flex flex-wrap justify-between gap-2 py-3 text-sm">
                    <span className="font-semibold text-slate-800">
                      {enrollment.classroom.name} · {enrollment.classroom.academicYear.name}
                    </span>
                    <span className="text-slate-500">
                      {enrollment.status} · {new Date(enrollment.enrolledAt).toLocaleDateString('fr-FR')}
                      {enrollment.endedAt
                        ? ` — ${new Date(enrollment.endedAt).toLocaleDateString('fr-FR')}`
                        : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-red-200 bg-red-50/60 p-5 sm:p-7">
            <h2 className="font-bold text-red-900">Archiver le dossier</h2>
            <p className="mt-1 text-sm text-red-800">
              L’élève sera retiré des listes actives et son inscription courante sera clôturée. Son historique est conservé.
            </p>
            <Button type="button" variant="outline" className="mt-4 border-red-300 text-red-700 hover:bg-red-100"
              onClick={() => void archive()} disabled={saving}>
              <Archive aria-hidden="true" className="h-4 w-4" />
              Archiver l’élève
            </Button>
          </section>
        </>
      ) : null}
    </div>
  );
}
