import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  BookOpenCheck,
  Building2,
  CalendarDays,
  ClipboardCheck,
  FileText,
  GraduationCap,
  Layers3,
  RefreshCw,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { chargerDashboard, type DashboardPlatform, type DashboardSchool } from '@/lib/dashboard';

const DashboardCharts = lazy(() => import('@/components/DashboardCharts'));

function CarteIndicateur({
  label,
  value,
  note,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  note?: string;
  icon: LucideIcon;
  tone: 'green' | 'blue' | 'gold' | 'violet';
}) {
  const toneStyles = {
    green: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
    blue: 'bg-sky-50 text-sky-700 ring-sky-100',
    gold: 'bg-amber-50 text-amber-700 ring-amber-100',
    violet: 'bg-violet-50 text-violet-700 ring-violet-100',
  };

  return (
    <article className="group rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_2px_12px_rgba(16,46,74,0.035)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_10px_28px_rgba(16,46,74,0.08)]">
      <div className="flex items-start justify-between gap-3">
        <p className="max-w-[13rem] text-[13px] font-medium leading-5 text-slate-500">{label}</p>
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ${toneStyles[tone]}`}>
          <Icon aria-hidden="true" className="h-[18px] w-[18px]" />
        </span>
      </div>
      <p className="mt-4 text-[2rem] font-bold leading-none tracking-tight text-[#153653] tabular-nums">
        {value.toLocaleString('fr-FR')}
      </p>
      {note && <p className="mt-2 text-xs text-slate-400">{note}</p>}
    </article>
  );
}

function ActionLink({
  to,
  icon: Icon,
  children,
}: {
  to: string;
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      className="group flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50/60 hover:text-[#126344]"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#edf6f1] text-[#18835a]">
        <Icon aria-hidden="true" className="h-[18px] w-[18px]" />
      </span>
      <span className="flex-1">{children}</span>
      <ArrowRight aria-hidden="true" className="h-4 w-4 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-[#18835a]" />
    </Link>
  );
}

export function DashboardPage() {
  const { user, school } = useAuth();
  const [donnees, setDonnees] = useState<DashboardSchool | DashboardPlatform | null>(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);

  const charger = useCallback(async () => {
    setChargement(true);
    setErreur(null);
    try {
      setDonnees(await chargerDashboard());
    } catch (e) {
      setErreur((e as Error).message);
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => {
    void charger();
  }, [charger]);

  const titreEtablissement = school?.name ?? (
    donnees?.scope === 'school' ? donnees.schoolName : null
  );
  const isPlatform = donnees?.scope === 'platform';

  return (
    <div className="space-y-8">
      <section className="relative isolate overflow-hidden rounded-[1.65rem] bg-[#123653] px-6 py-7 text-white shadow-[0_14px_38px_rgba(16,46,74,0.15)] sm:px-8 sm:py-8 lg:px-10">
        <div aria-hidden="true" className="absolute -right-10 -top-32 -z-10 h-80 w-80 rounded-full border-[44px] border-white/[0.045]" />
        <div aria-hidden="true" className="absolute -bottom-28 right-36 -z-10 h-56 w-56 rounded-full bg-[#1a9b70]/20 blur-2xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-2xl">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.08] px-3 py-1.5 text-xs font-medium text-white/80">
              <CalendarDays aria-hidden="true" className="h-3.5 w-3.5 text-emerald-300" />
              {donnees?.scope === 'school' && donnees.academicYear
                ? donnees.academicYear.name
                : 'Votre espace de gestion'}
            </div>
            <p className="text-sm font-medium text-emerald-200">
              {titreEtablissement ?? (isPlatform ? 'Administration générale' : 'Bulletins Scolaires')}
            </p>
            <h1 className="mt-1.5 text-2xl font-bold tracking-tight sm:text-3xl">
              Bonjour{user?.name ? `, ${user.name.split(/\s+/)[0]}` : ''}
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-blue-100/75">
              {isPlatform
                ? 'Retrouvez ici les indicateurs clés et gérez les établissements de la plateforme.'
                : 'Retrouvez en un coup d’œil les informations et les activités de votre établissement.'}
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => void charger()}
            disabled={chargement}
            className="border-white/20 bg-white/10 text-white hover:border-white/30 hover:bg-white/15 hover:text-white"
          >
            <RefreshCw aria-hidden="true" className={`h-4 w-4 ${chargement ? 'animate-spin' : ''}`} />
            Actualiser
          </Button>
        </div>
      </section>

      {erreur && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-800">
          <span>{erreur}</span>
          <Button variant="outline" size="sm" onClick={() => void charger()}>Réessayer</Button>
        </div>
      )}

      {chargement && !donnees ? (
        <div role="status" className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500 shadow-sm">
          <RefreshCw aria-hidden="true" className="mx-auto mb-3 h-5 w-5 animate-spin text-emerald-600" />
          Chargement des indicateurs…
        </div>
      ) : donnees?.scope === 'platform' ? (
        <>
          <section aria-label="Indicateurs plateforme">
            <div className="mb-4 flex items-end justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-slate-800">Vue de la plateforme</h2>
                <p className="mt-1 text-sm text-slate-500">Les indicateurs globaux de votre espace.</p>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <CarteIndicateur label="Établissements" value={donnees.indicators.schools} icon={Building2} tone="blue" />
              <CarteIndicateur label="Établissements actifs" value={donnees.indicators.activeSchools} icon={Layers3} tone="green" />
              <CarteIndicateur label="Comptes utilisateurs" value={donnees.indicators.users} icon={Users} tone="violet" />
            </div>
          </section>
          <section className="grid gap-3 sm:grid-cols-2">
            <ActionLink to="/etablissements" icon={Building2}>Gérer les établissements</ActionLink>
            <ActionLink to="/demandes-inscription" icon={ClipboardCheck}>Traiter les demandes d’inscription</ActionLink>
          </section>
        </>
      ) : donnees?.scope === 'school' ? (
        <>
          <section aria-label="Indicateurs établissement">
            <div className="mb-4">
              <h2 className="text-base font-bold text-slate-800">Les chiffres clés</h2>
              <p className="mt-1 text-sm text-slate-500">L’activité de votre établissement cette année.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <CarteIndicateur label="Élèves inscrits" value={donnees.indicators.enrollments} note={`${donnees.indicators.students} fiches élèves`} icon={GraduationCap} tone="blue" />
              <CarteIndicateur label="Classes" value={donnees.indicators.classrooms} icon={Layers3} tone="violet" />
              <CarteIndicateur label="Évaluations" value={donnees.indicators.assessments} icon={ClipboardCheck} tone="gold" />
              <CarteIndicateur label="Disciplines" value={donnees.indicators.subjects} icon={BookOpenCheck} tone="green" />
              <CarteIndicateur label="Bulletins générés" value={donnees.indicators.bulletins} icon={FileText} tone="blue" />
              <CarteIndicateur label="Bulletins publiés" value={donnees.indicators.publishedBulletins} icon={FileText} tone="green" />
              <CarteIndicateur
                label="Absences et retards"
                value={donnees.semesters.reduce((total, semester) => total + semester.absences + semester.retards, 0)}
                note="Événements enregistrés cette année"
                icon={BookOpenCheck}
                tone="gold"
              />
            </div>
          </section>

          {donnees.semesters.length > 0 ? (
            <section>
              <div className="mb-4">
                <h2 className="text-base font-bold text-slate-800">Suivi de l’année scolaire</h2>
                <p className="mt-1 text-sm text-slate-500">Progression des bulletins et vie scolaire par semestre.</p>
              </div>
              <Suspense fallback={<div role="status" className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Chargement des graphiques…</div>}>
                <DashboardCharts semesters={donnees.semesters} />
              </Suspense>
            </section>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
              <CalendarDays aria-hidden="true" className="mx-auto h-8 w-8 text-slate-300" />
              <h2 className="mt-3 font-semibold text-slate-700">Aucune année scolaire active</h2>
              <p className="mt-1 text-sm text-slate-500">Les indicateurs et graphiques apparaîtront dès qu’une année sera activée.</p>
            </div>
          )}

          <section>
            <div className="mb-4">
              <h2 className="text-base font-bold text-slate-800">Accès rapides</h2>
              <p className="mt-1 text-sm text-slate-500">Accédez directement aux tâches courantes.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <ActionLink to="/saisie-notes" icon={ClipboardCheck}>Saisir des notes</ActionLink>
              <ActionLink to="/bulletins" icon={FileText}>Consulter les bulletins</ActionLink>
              <ActionLink to="/vie-scolaire" icon={BookOpenCheck}>Ouvrir la vie scolaire</ActionLink>
            </div>
          </section>
        </>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
          Aucun indicateur disponible pour le moment.
        </div>
      )}
    </div>
  );
}
