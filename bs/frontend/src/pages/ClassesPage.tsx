import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { CalendarDays, GraduationCap, Layers3, Plus, School, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';

type AcademicYear = {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
  status: 'PREPARATION' | 'ACTIVE' | 'CLOSED';
  semesters: Semester[];
};

type Semester = {
  id: string;
  number: number;
  name: string;
  startsAt: string;
  endsAt: string;
};

type YearEdit = { name: string; startsAt: string; endsAt: string };
type Level = { id: string; name: string; sortOrder: number };
type Series = { id: string; name: string; levelId: string | null };
type Classroom = {
  id: string;
  name: string;
  academicYear: AcademicYear;
  level: Level;
  series: Series | null;
  _count: { enrollments: number };
};

type SelectOptions = {
  years: AcademicYear[];
  levels: Level[];
  series: Series[];
};

const NIVEAUX_RECOMMANDES = [
  '6e',
  '5e',
  '4e',
  '3e',
  'Seconde',
  'Première',
  'Terminale',
];

function cleNiveau(name: string) {
  const normalise = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase('fr-FR');
  const alias: Record<string, string> = {
    sixieme: '6e',
    cinquieme: '5e',
    quatrieme: '4e',
    troisieme: '3e',
  };
  return alias[normalise] ?? normalise;
}

const inputClass =
  'h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-800 outline-none transition focus:border-emerald-600 focus:ring-4 focus:ring-emerald-600/10';

function dateInput(value: string) {
  return new Date(value).toISOString().slice(0, 10);
}

async function lireReponse<T>(response: Response, fallback: string): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      typeof body.error === 'string' ? body.error : fallback,
    );
  }
  return body as T;
}

export function ClassesPage() {
  const [options, setOptions] = useState<SelectOptions>({ years: [], levels: [], series: [] });
  const [classes, setClasses] = useState<Classroom[]>([]);
  const [academicYearId, setAcademicYearId] = useState('');
  const [levelId, setLevelId] = useState('');
  const [seriesId, setSeriesId] = useState('');
  const [name, setName] = useState('');
  const [yearName, setYearName] = useState('');
  const [yearStartsAt, setYearStartsAt] = useState('');
  const [yearEndsAt, setYearEndsAt] = useState('');
  const [levelName, setLevelName] = useState('');
  const [seriesName, setSeriesName] = useState('');
  const [seriesLevelId, setSeriesLevelId] = useState('');
  const [yearEdits, setYearEdits] = useState<Record<string, YearEdit>>({});
  const [semesterDates, setSemesterDates] = useState<Record<string, { startsAt: string; endsAt: string }>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadClasses = useCallback(async () => {
    const response = await api.fetch('/api/schooling/classes');
    const body = await lireReponse<{ classes: Classroom[] }>(
      response,
      'Impossible de charger les classes',
    );
    setClasses(body.classes);
  }, []);

  const loadPage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [yearsResponse, levelsResponse, seriesResponse, classesResponse] =
        await Promise.all([
          api.fetch('/api/schooling/years'),
          api.fetch('/api/schooling/levels'),
          api.fetch('/api/schooling/series'),
          api.fetch('/api/schooling/classes'),
        ]);
      const [yearsData, levelsData, seriesData, classesData] = await Promise.all([
        lireReponse<{ years: AcademicYear[] }>(yearsResponse, 'Impossible de charger les années scolaires'),
        lireReponse<{ levels: Level[] }>(levelsResponse, 'Impossible de charger les niveaux'),
        lireReponse<{ series: Series[] }>(seriesResponse, 'Impossible de charger les séries'),
        lireReponse<{ classes: Classroom[] }>(classesResponse, 'Impossible de charger les classes'),
      ]);
      setOptions({
        years: yearsData.years,
        levels: levelsData.levels,
        series: seriesData.series,
      });
      setYearEdits(Object.fromEntries(
        yearsData.years.map((year) => [
          year.id,
          { name: year.name, startsAt: dateInput(year.startsAt), endsAt: dateInput(year.endsAt) },
        ]),
      ));
      setSemesterDates(Object.fromEntries(
        yearsData.years.flatMap((year) =>
          year.semesters.map((semester) => [
            semester.id,
            { startsAt: dateInput(semester.startsAt), endsAt: dateInput(semester.endsAt) },
          ]),
        ),
      ));
      setClasses(classesData.classes);
      setAcademicYearId((current) =>
        current && yearsData.years.some((year) => year.id === current)
          ? current
          : yearsData.years.find((year) => year.status === 'ACTIVE')?.id ??
            yearsData.years.find((year) => year.status !== 'CLOSED')?.id ??
            '',
      );
      setLevelId((current) =>
        current && levelsData.levels.some((level) => level.id === current)
          ? current
          : levelsData.levels[0]?.id ?? '',
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Impossible de charger les classes');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPage();
  }, [loadPage]);

  const availableSeries = useMemo(
    () => options.series.filter((series) => !series.levelId || series.levelId === levelId),
    [options.series, levelId],
  );

  useEffect(() => {
    if (seriesId && !availableSeries.some((series) => series.id === seriesId)) {
      setSeriesId('');
    }
  }, [availableSeries, seriesId]);

  const createClass = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setSaving(true);
    try {
      const response = await api.fetch('/api/schooling/classes', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          academicYearId,
          levelId,
          seriesId: seriesId || null,
        }),
      });
      await lireReponse<{ classroom: Classroom }>(response, 'Impossible de créer la classe');
      setName('');
      setMessage('La classe a été créée.');
      await loadClasses();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Impossible de créer la classe');
    } finally {
      setSaving(false);
    }
  };

  const createYear = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setSaving(true);
    try {
      const response = await api.fetch('/api/schooling/years', {
        method: 'POST',
        body: JSON.stringify({
          name: yearName.trim(),
          startsAt: new Date(`${yearStartsAt}T00:00:00.000Z`).toISOString(),
          endsAt: new Date(`${yearEndsAt}T23:59:59.999Z`).toISOString(),
          status: 'PREPARATION',
        }),
      });
      await lireReponse<{ year: AcademicYear }>(response, 'Impossible de créer l’année scolaire');
      setYearName('');
      setYearStartsAt('');
      setYearEndsAt('');
      setMessage('L’année scolaire et ses deux semestres ont été créés.');
      await loadPage();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Impossible de créer l’année scolaire');
    } finally {
      setSaving(false);
    }
  };

  const updateYearStatus = async (year: AcademicYear, status: AcademicYear['status']) => {
    if (status === year.status) return;
    if (status === 'CLOSED' && !window.confirm(`Clôturer l’année ${year.name} ? Elle ne pourra plus être modifiée.`)) {
      return;
    }
    setError(null);
    setMessage(null);
    try {
      const response = await api.fetch(`/api/schooling/years/${year.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      await lireReponse<{ year: AcademicYear }>(response, 'Impossible de modifier le statut de l’année');
      setMessage(`Statut de l’année ${year.name} mis à jour.`);
      await loadPage();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Impossible de modifier le statut de l’année');
    }
  };

  const updateYear = async (yearId: string) => {
    const edit = yearEdits[yearId];
    if (!edit?.name.trim() || !edit.startsAt || !edit.endsAt) return;
    setError(null);
    setMessage(null);
    try {
      const response = await api.fetch(`/api/schooling/years/${yearId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: edit.name.trim(),
          startsAt: new Date(`${edit.startsAt}T00:00:00.000Z`).toISOString(),
          endsAt: new Date(`${edit.endsAt}T23:59:59.999Z`).toISOString(),
        }),
      });
      await lireReponse<{ year: AcademicYear }>(response, 'Impossible de modifier l’année scolaire');
      setMessage('Année scolaire mise à jour.');
      await loadPage();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Impossible de modifier l’année scolaire');
    }
  };

  const updateSemesterDates = async (semesterId: string) => {
    const dates = semesterDates[semesterId];
    if (!dates?.startsAt || !dates.endsAt) return;
    setError(null);
    setMessage(null);
    try {
      const response = await api.fetch(`/api/schooling/semesters/${semesterId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          startsAt: new Date(`${dates.startsAt}T00:00:00.000Z`).toISOString(),
          endsAt: new Date(`${dates.endsAt}T23:59:59.999Z`).toISOString(),
        }),
      });
      await lireReponse<{ semester: Semester }>(response, 'Impossible de modifier les dates du semestre');
      setMessage('Période du semestre enregistrée.');
      await loadPage();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Impossible de modifier les dates du semestre');
    }
  };

  const createLevel = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setSaving(true);
    try {
      const response = await api.fetch('/api/schooling/levels', {
        method: 'POST',
        body: JSON.stringify({ name: levelName.trim(), sortOrder: options.levels.length }),
      });
      await lireReponse<{ level: Level }>(response, 'Impossible de créer le niveau');
      setLevelName('');
      setMessage('Niveau ajouté.');
      await loadPage();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Impossible de créer le niveau');
    } finally {
      setSaving(false);
    }
  };

  const addRecommendedLevels = async () => {
    setError(null);
    setMessage(null);
    setSaving(true);
    try {
      const existants = new Set(options.levels.map((level) => cleNiveau(level.name)));
      const manquants = NIVEAUX_RECOMMANDES.filter(
        (level) => !existants.has(cleNiveau(level)),
      );
      for (const [index, level] of manquants.entries()) {
        const response = await api.fetch('/api/schooling/levels', {
          method: 'POST',
          body: JSON.stringify({ name: level, sortOrder: options.levels.length + index }),
        });
        await lireReponse<{ level: Level }>(response, `Impossible d’ajouter le niveau ${level}`);
      }
      setMessage(manquants.length ? 'Les niveaux recommandés ont été ajoutés.' : 'Tous les niveaux recommandés existent déjà.');
      await loadPage();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Impossible d’ajouter les niveaux recommandés');
      await loadPage();
    } finally {
      setSaving(false);
    }
  };

  const createRecommendedLevelsAndClasses = async () => {
    const activeYear = options.years.find((year) => year.status === 'ACTIVE');
    if (!activeYear) {
      setError('Activez une année scolaire avant de créer les classes recommandées.');
      setMessage(null);
      return;
    }

    setError(null);
    setMessage(null);
    setSaving(true);
    let createdLevels = 0;
    let createdClasses = 0;
    let existingClasses = 0;
    try {
      const levelsByName = new Map(
        options.levels.map((level) => [cleNiveau(level.name), level]),
      );
      for (const [index, levelName] of NIVEAUX_RECOMMANDES.entries()) {
        const key = cleNiveau(levelName);
        if (levelsByName.has(key)) continue;
        const response = await api.fetch('/api/schooling/levels', {
          method: 'POST',
          body: JSON.stringify({ name: levelName, sortOrder: options.levels.length + index }),
        });
        const body = await lireReponse<{ level: Level }>(
          response,
          `Impossible d’ajouter le niveau ${levelName}`,
        );
        levelsByName.set(key, body.level);
        createdLevels += 1;
      }

      const classedLevelIds = new Set(
        classes
          .filter((classroom) => classroom.academicYear.id === activeYear.id)
          .map((classroom) => classroom.level.id),
      );
      for (const levelName of NIVEAUX_RECOMMANDES) {
        const level = levelsByName.get(cleNiveau(levelName));
        if (!level) throw new Error(`Le niveau ${levelName} n’a pas pu être chargé`);
        if (classedLevelIds.has(level.id)) {
          existingClasses += 1;
          continue;
        }
        const response = await api.fetch('/api/schooling/classes', {
          method: 'POST',
          body: JSON.stringify({
            name: levelName,
            academicYearId: activeYear.id,
            levelId: level.id,
            seriesId: null,
          }),
        });
        await lireReponse<{ classroom: Classroom }>(
          response,
          `Impossible de créer la classe ${levelName}`,
        );
        classedLevelIds.add(level.id);
        createdClasses += 1;
      }

      setAcademicYearId(activeYear.id);
      setMessage(
        `${createdLevels} niveau(x) ajouté(s), ${createdClasses} classe(s) créée(s) pour ${activeYear.name}.` +
          (existingClasses ? ` ${existingClasses} classe(s) déjà présente(s) ignorée(s).` : ''),
      );
      await loadPage();
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : 'Erreur inconnue';
      await loadPage();
      setError(
        `${detail} Opération partielle : ${createdLevels} niveau(x) ajouté(s), ${createdClasses} classe(s) créée(s).`,
      );
    } finally {
      setSaving(false);
    }
  };

  const createSeries = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setSaving(true);
    try {
      const response = await api.fetch('/api/schooling/series', {
        method: 'POST',
        body: JSON.stringify({
          name: seriesName.trim(),
          ...(seriesLevelId ? { levelId: seriesLevelId } : {}),
        }),
      });
      await lireReponse<{ series: Series }>(response, 'Impossible de créer la série');
      setSeriesName('');
      setMessage('Série ajoutée.');
      await loadPage();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Impossible de créer la série');
    } finally {
      setSaving(false);
    }
  };

  const activeClasses = classes.filter((classroom) => classroom.academicYear.status === 'ACTIVE');
  const hasOpenYear = options.years.some((year) => year.status !== 'CLOSED');
  const hasActiveYear = options.years.some((year) => year.status === 'ACTIVE');
  const canCreate = hasOpenYear && options.levels.length > 0;

  return (
    <div className="space-y-8">
      <section className="relative isolate overflow-hidden rounded-[1.65rem] bg-[#123653] px-6 py-7 text-white shadow-[0_14px_38px_rgba(16,46,74,0.12)] sm:px-8 sm:py-8 lg:px-10">
        <div aria-hidden="true" className="absolute -right-10 -top-32 -z-10 h-80 w-80 rounded-full border-[44px] border-white/[0.045]" />
        <div className="relative flex items-center gap-4">
          <span className="hidden h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/10 sm:flex">
            <School aria-hidden="true" className="h-7 w-7 text-emerald-200" />
          </span>
          <div>
            <p className="text-sm font-medium text-emerald-200">Organisation pédagogique</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Classes et années</h1>
            <p className="mt-2 text-sm text-blue-100/75">
              Gérez les années scolaires, semestres, niveaux, séries et classes de votre établissement.
            </p>
          </div>
        </div>
      </section>

      {error && (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-800">
          {error}
        </div>
      )}
      {message && (
        <div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-800">
          {message}
        </div>
      )}

      <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-7">
        <div className="mb-6">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-50 text-sky-700">
              <CalendarDays aria-hidden="true" className="h-5 w-5" />
            </span>
            <h2 className="text-base font-bold text-slate-800">Années scolaires et semestres</h2>
          </div>
          <p className="mt-2 text-sm text-slate-500">
            Chaque année comprend deux semestres. Les périodes semestrielles sont ajustables dans les dates de l’année.
          </p>
        </div>
        <form onSubmit={createYear} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <label className="space-y-2 text-sm font-semibold text-slate-700">
            Nom de l’année
            <input
              className={inputClass}
              value={yearName}
              onChange={(event) => setYearName(event.target.value)}
              placeholder="Ex. 2026-2027"
              minLength={5}
              required
            />
          </label>
          <label className="space-y-2 text-sm font-semibold text-slate-700">
            Date de début
            <input className={inputClass} type="date" value={yearStartsAt} onChange={(event) => setYearStartsAt(event.target.value)} required />
          </label>
          <label className="space-y-2 text-sm font-semibold text-slate-700">
            Date de fin
            <input className={inputClass} type="date" value={yearEndsAt} onChange={(event) => setYearEndsAt(event.target.value)} required />
          </label>
          <div className="flex items-end">
            <Button type="submit" className="w-full" disabled={saving}>
              <Plus aria-hidden="true" className="h-4 w-4" />
              Créer l’année scolaire
            </Button>
          </div>
        </form>

        {!loading && options.years.length > 0 && (
          <div className="mt-6 space-y-4">
            {options.years.map((year) => (
              <article key={year.id} className="rounded-2xl border border-slate-200 p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <label className="flex items-center gap-2 text-xs font-medium text-slate-500">
                    Statut
                    <select
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-semibold text-slate-700"
                      value={year.status}
                      disabled={year.status === 'CLOSED'}
                      onChange={(event) => void updateYearStatus(year, event.target.value as AcademicYear['status'])}
                    >
                      <option value="PREPARATION">Préparation</option>
                      <option value="ACTIVE">Active</option>
                      <option value="CLOSED">Clôturée</option>
                    </select>
                  </label>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
                  <label className="space-y-1.5 text-xs font-medium text-slate-500">
                    Nom de l’année
                    <input
                      className={inputClass}
                      value={yearEdits[year.id]?.name ?? year.name}
                      disabled={year.status === 'CLOSED'}
                      onChange={(event) => setYearEdits((current) => ({
                        ...current,
                        [year.id]: {
                          ...current[year.id],
                          name: event.target.value,
                          startsAt: current[year.id]?.startsAt ?? dateInput(year.startsAt),
                          endsAt: current[year.id]?.endsAt ?? dateInput(year.endsAt),
                        },
                      }))}
                    />
                  </label>
                  <label className="space-y-1.5 text-xs font-medium text-slate-500">
                    Début de l’année
                    <input
                      type="date"
                      className={inputClass}
                      value={yearEdits[year.id]?.startsAt ?? dateInput(year.startsAt)}
                      disabled={year.status === 'CLOSED'}
                      onChange={(event) => setYearEdits((current) => ({
                        ...current,
                        [year.id]: {
                          ...current[year.id],
                          name: current[year.id]?.name ?? year.name,
                          startsAt: event.target.value,
                          endsAt: current[year.id]?.endsAt ?? dateInput(year.endsAt),
                        },
                      }))}
                    />
                  </label>
                  <label className="space-y-1.5 text-xs font-medium text-slate-500">
                    Fin de l’année
                    <input
                      type="date"
                      className={inputClass}
                      value={yearEdits[year.id]?.endsAt ?? dateInput(year.endsAt)}
                      disabled={year.status === 'CLOSED'}
                      onChange={(event) => setYearEdits((current) => ({
                        ...current,
                        [year.id]: {
                          ...current[year.id],
                          name: current[year.id]?.name ?? year.name,
                          startsAt: current[year.id]?.startsAt ?? dateInput(year.startsAt),
                          endsAt: event.target.value,
                        },
                      }))}
                    />
                  </label>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={year.status === 'CLOSED'}
                    onClick={() => void updateYear(year.id)}
                  >
                    Enregistrer
                  </Button>
                </div>
                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  {year.semesters.map((semester) => (
                    <div key={semester.id} className="rounded-xl bg-slate-50 p-3.5">
                      <p className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-600">{semester.name}</p>
                      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                        <label className="space-y-1.5 text-xs font-medium text-slate-500">
                          Début
                          <input
                            type="date"
                            className={inputClass}
                            value={semesterDates[semester.id]?.startsAt ?? dateInput(semester.startsAt)}
                            disabled={year.status === 'CLOSED'}
                            onChange={(event) => setSemesterDates((current) => ({
                              ...current,
                              [semester.id]: { ...current[semester.id], startsAt: event.target.value, endsAt: current[semester.id]?.endsAt ?? dateInput(semester.endsAt) },
                            }))}
                          />
                        </label>
                        <label className="space-y-1.5 text-xs font-medium text-slate-500">
                          Fin
                          <input
                            type="date"
                            className={inputClass}
                            value={semesterDates[semester.id]?.endsAt ?? dateInput(semester.endsAt)}
                            disabled={year.status === 'CLOSED'}
                            onChange={(event) => setSemesterDates((current) => ({
                              ...current,
                              [semester.id]: { ...current[semester.id], startsAt: current[semester.id]?.startsAt ?? dateInput(semester.startsAt), endsAt: event.target.value },
                            }))}
                          />
                        </label>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={year.status === 'CLOSED'}
                          onClick={() => void updateSemesterDates(semester.id)}
                        >
                          Enregistrer
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <article className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-7">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-50 text-violet-700">
                <GraduationCap aria-hidden="true" className="h-5 w-5" />
              </span>
              <h2 className="text-base font-bold text-slate-800">Niveaux</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={saving}
                onClick={() => void addRecommendedLevels()}
              >
                Ajouter les 7 niveaux
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={saving || !hasActiveYear}
                title={!hasActiveYear ? 'Activez une année scolaire pour continuer' : undefined}
                onClick={() => void createRecommendedLevelsAndClasses()}
              >
                {saving ? 'Création en cours…' : 'Créer les 7 classes · année active'}
              </Button>
            </div>
          </div>
          {!loading && !hasActiveYear && (
            <p className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Activez une année scolaire pour créer automatiquement une classe par niveau.
            </p>
          )}
          <form onSubmit={createLevel} className="flex flex-col gap-3 sm:flex-row">
            <input
              className={inputClass}
              aria-label="Nom du niveau"
              placeholder="Ex. 6e, Terminale"
              value={levelName}
              onChange={(event) => setLevelName(event.target.value)}
              required
            />
            <Button type="submit" disabled={saving}>Ajouter</Button>
          </form>
          <div className="mt-4 flex flex-wrap gap-2">
            {options.levels.map((level) => (
              <span key={level.id} className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700">
                {level.name}
              </span>
            ))}
            {!loading && options.levels.length === 0 && (
              <p className="text-sm text-slate-500">Aucun niveau configuré.</p>
            )}
          </div>
        </article>

        <article className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-7">
          <div className="mb-5 flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
              <Layers3 aria-hidden="true" className="h-5 w-5" />
            </span>
            <h2 className="text-base font-bold text-slate-800">Séries</h2>
          </div>
          <form onSubmit={createSeries} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <input
              className={inputClass}
              aria-label="Nom de la série"
              placeholder="Ex. L1, S2"
              value={seriesName}
              onChange={(event) => setSeriesName(event.target.value)}
              required
            />
            <select
              className={inputClass}
              aria-label="Niveau associé à la série"
              value={seriesLevelId}
              onChange={(event) => setSeriesLevelId(event.target.value)}
            >
              <option value="">Tous les niveaux</option>
              {options.levels.map((level) => (
                <option key={level.id} value={level.id}>{level.name}</option>
              ))}
            </select>
            <Button type="submit" disabled={saving}>Ajouter</Button>
          </form>
          <div className="mt-4 flex flex-wrap gap-2">
            {options.series.map((series) => (
              <span key={series.id} className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700">
                {series.name}{series.levelId ? ` · ${options.levels.find((level) => level.id === series.levelId)?.name ?? ''}` : ''}
              </span>
            ))}
            {!loading && options.series.length === 0 && (
              <p className="text-sm text-slate-500">Aucune série configurée.</p>
            )}
          </div>
        </article>
      </section>

      <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-7">
        <div className="mb-6">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#edf6f1] text-[#18835a]">
              <Plus aria-hidden="true" className="h-5 w-5" />
            </span>
            <h2 className="text-base font-bold text-slate-800">Créer une classe</h2>
          </div>
          <p className="mt-2 text-sm text-slate-500">
            Choisissez l’année et le niveau, puis donnez un nom à la classe.
          </p>
        </div>

        {loading ? (
          <p role="status" className="py-4 text-sm text-slate-500">Chargement des années et des niveaux…</p>
        ) : !hasOpenYear ? (
          <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Aucune année scolaire ouverte. Créez ou réactivez une année scolaire avant d’ajouter une classe.
          </p>
        ) : options.levels.length === 0 ? (
          <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Aucun niveau n’est configuré. Ajoutez d’abord les niveaux dans la gestion de l’établissement.
          </p>
        ) : (
          <form onSubmit={createClass} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <label className="space-y-2 text-sm font-semibold text-slate-700">
              Année scolaire
              <select
                className={inputClass}
                value={academicYearId}
                onChange={(event) => setAcademicYearId(event.target.value)}
                required
              >
                {options.years.filter((year) => year.status !== 'CLOSED').map((year) => (
                  <option key={year.id} value={year.id}>
                    {year.name}{year.status === 'ACTIVE' ? ' · En cours' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-2 text-sm font-semibold text-slate-700">
              Niveau
              <select
                className={inputClass}
                value={levelId}
                onChange={(event) => setLevelId(event.target.value)}
                required
              >
                {options.levels.map((level) => (
                  <option key={level.id} value={level.id}>{level.name}</option>
                ))}
              </select>
            </label>
            <label className="space-y-2 text-sm font-semibold text-slate-700">
              Série <span className="font-normal text-slate-400">(facultatif)</span>
              <select
                className={inputClass}
                value={seriesId}
                onChange={(event) => setSeriesId(event.target.value)}
              >
                <option value="">Aucune série</option>
                {availableSeries.map((series) => (
                  <option key={series.id} value={series.id}>{series.name}</option>
                ))}
              </select>
            </label>
            <label className="space-y-2 text-sm font-semibold text-slate-700">
              Nom de la classe
              <input
                className={inputClass}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Ex. 6e A, Terminale S2"
                required
                maxLength={100}
              />
            </label>
            <div className="sm:col-span-2 xl:col-span-4">
              <Button type="submit" disabled={!canCreate || saving || !academicYearId || !levelId}>
                <Plus aria-hidden="true" className="h-4 w-4" />
                {saving ? 'Création en cours…' : 'Créer la classe'}
              </Button>
            </div>
          </form>
        )}
      </section>

      <section>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-800">Classes de l’établissement</h2>
            <p className="mt-1 text-sm text-slate-500">Les effectifs correspondent aux inscriptions actives.</p>
          </div>
          <span className="rounded-full bg-[#e8f4ef] px-3 py-1 text-xs font-semibold text-[#176b4e]">
            {activeClasses.length} {activeClasses.length === 1 ? 'classe active' : 'classes actives'}
          </span>
        </div>

        {loading ? (
          <div role="status" className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
            Chargement des classes…
          </div>
        ) : classes.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-9 text-center">
            <GraduationCap aria-hidden="true" className="mx-auto h-8 w-8 text-slate-300" />
            <p className="mt-3 font-semibold text-slate-700">Aucune classe pour le moment</p>
            <p className="mt-1 text-sm text-slate-500">Les classes créées apparaîtront ici.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-left text-sm">
                <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-5 py-3.5">Classe</th>
                    <th className="px-5 py-3.5">Niveau / série</th>
                    <th className="px-5 py-3.5">Année scolaire</th>
                    <th className="px-5 py-3.5 text-right">Effectif</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {classes.map((classroom) => (
                    <tr key={classroom.id} className="transition hover:bg-slate-50/70">
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-50 text-sky-700">
                            <Layers3 aria-hidden="true" className="h-4 w-4" />
                          </span>
                          <span className="font-semibold text-slate-800">{classroom.name}</span>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-slate-600">
                        {classroom.level.name}{classroom.series ? ` · ${classroom.series.name}` : ''}
                      </td>
                      <td className="px-5 py-4">
                        <span className="inline-flex items-center gap-2 text-slate-600">
                          <CalendarDays aria-hidden="true" className="h-4 w-4 text-slate-400" />
                          {classroom.academicYear.name}
                          {classroom.academicYear.status === 'ACTIVE' && (
                            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                              En cours
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <span className="inline-flex items-center justify-end gap-2 font-semibold tabular-nums text-slate-700">
                          <Users aria-hidden="true" className="h-4 w-4 text-slate-400" />
                          {classroom._count.enrollments}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
