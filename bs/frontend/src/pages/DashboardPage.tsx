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
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
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
  tone: 'green' | 'blue' | 'gold' | 'navy';
}) {
  const toneStyles = {
    green: 'bg-primary/10 text-primary ring-primary/15',
    blue: 'bg-secondary/10 text-secondary ring-secondary/15',
    gold: 'bg-accent/25 text-foreground ring-accent/40',
    navy: 'bg-secondary/10 text-secondary ring-secondary/15',
  };

  return (
    <Card className="min-h-32 gap-0">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardDescription className="max-w-[13rem] text-[13px] font-semibold leading-5 text-muted-foreground">{label}</CardDescription>
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ${toneStyles[tone]}`}>
          <Icon aria-hidden="true" className="h-[18px] w-[18px]" />
        </span>
      </CardHeader>
      <CardContent className="pt-0">
        <p className="text-[2rem] font-bold leading-none tracking-tight text-brand-navy tabular-nums">
          {value.toLocaleString('fr-FR')}
        </p>
        {note && <p className="mt-2 text-xs text-muted-foreground">{note}</p>}
      </CardContent>
    </Card>
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
      className="group flex min-h-14 items-center gap-3 rounded-xl border border-border/80 bg-card px-4 py-3.5 text-sm font-semibold text-foreground shadow-[0_1px_2px_rgb(16_45_69/0.04)] transition-[border-color,background-color,box-shadow] duration-150 hover:border-primary/40 hover:bg-white hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon aria-hidden="true" className="h-[18px] w-[18px]" />
      </span>
      <span className="flex-1">{children}</span>
      <ArrowRight aria-hidden="true" className="h-4 w-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" />
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
    <div className="space-y-9">
      <section className="relative overflow-hidden rounded-2xl bg-brand-navy px-6 py-7 text-white shadow-[0_12px_30px_rgb(11_45_79/0.12)] sm:px-8 sm:py-8 lg:px-10">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-2xl">
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Bonjour{user?.name ? `, ${user.name.split(/\s+/)[0]}` : ''}
            </h1>
            <p className="mt-2 text-sm font-medium text-white/85">
              {titreEtablissement ?? (isPlatform ? 'Administration générale' : 'Bulletins Scolaires')}
            </p>
            <p className="mt-2 max-w-xl text-sm leading-6 text-white/75">
              {isPlatform
                ? 'Retrouvez ici les indicateurs clés et gérez les établissements de la plateforme.'
                : 'Retrouvez en un coup d’œil les informations et les activités de votre établissement.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {donnees?.scope === 'school' && donnees.academicYear && (
              <span className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-white/15 bg-white/[0.08] px-3 text-sm font-medium text-white/90">
                <CalendarDays aria-hidden="true" className="h-4 w-4 text-accent" />
                {donnees.academicYear.name}
              </span>
            )}
            <Button
              variant="outline"
              onClick={() => void charger()}
              disabled={chargement}
              className="min-h-10 border-white/25 bg-white/5 text-white hover:border-white/40 hover:bg-white/10 hover:text-white"
            >
              <RefreshCw aria-hidden="true" className={`h-4 w-4 ${chargement ? 'animate-spin' : ''}`} />
              Actualiser
            </Button>
          </div>
        </div>
      </section>

      {erreur && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-5 py-4 text-sm text-destructive">
          <span>{erreur}</span>
          <Button variant="outline" size="sm" onClick={() => void charger()}>Réessayer</Button>
        </div>
      )}

      {chargement && !donnees ? (
        <div role="status" className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          <RefreshCw aria-hidden="true" className="mx-auto mb-3 h-5 w-5 animate-spin text-primary" />
          Chargement des indicateurs…
        </div>
      ) : donnees?.scope === 'platform' ? (
        <>
          <section aria-label="Indicateurs plateforme">
            <div className="mb-5 flex items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold tracking-tight text-foreground">Vue de la plateforme</h2>
                <p className="mt-1 text-sm text-muted-foreground">Les indicateurs globaux de votre espace.</p>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <CarteIndicateur label="Établissements" value={donnees.indicators.schools} icon={Building2} tone="blue" />
              <CarteIndicateur label="Établissements actifs" value={donnees.indicators.activeSchools} icon={Layers3} tone="green" />
              <CarteIndicateur label="Comptes utilisateurs" value={donnees.indicators.users} icon={Users} tone="navy" />
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
            <div className="mb-5">
              <h2 className="text-lg font-bold tracking-tight text-foreground">Les chiffres clés</h2>
              <p className="mt-1 text-sm text-muted-foreground">L’activité de votre établissement cette année.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <CarteIndicateur label="Élèves inscrits" value={donnees.indicators.enrollments} note={`${donnees.indicators.students} fiches élèves`} icon={GraduationCap} tone="blue" />
              <CarteIndicateur label="Classes" value={donnees.indicators.classrooms} icon={Layers3} tone="navy" />
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
              <div className="mb-5">
                <h2 className="text-lg font-bold tracking-tight text-foreground">Suivi de l’année scolaire</h2>
                <p className="mt-1 text-sm text-muted-foreground">Progression des bulletins et vie scolaire par semestre.</p>
              </div>
              <Suspense
                fallback={
                  <div role="status" aria-label="Chargement des graphiques" className="grid gap-5 lg:grid-cols-2">
                    <span className="sr-only">Chargement des graphiques…</span>
                    {[0, 1].map((chart) => (
                      <div key={chart} aria-hidden="true" className="rounded-2xl border border-border/80 bg-card p-5 shadow-sm">
                        <Skeleton className="h-4 w-36 motion-reduce:animate-none" />
                        <Skeleton className="mt-3 h-3 w-56 max-w-full motion-reduce:animate-none" />
                        <Skeleton className="mt-6 h-52 w-full motion-reduce:animate-none" />
                      </div>
                    ))}
                  </div>
                }
              >
                <DashboardCharts semesters={donnees.semesters} />
              </Suspense>
            </section>
          ) : (
            <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center">
              <CalendarDays aria-hidden="true" className="mx-auto h-8 w-8 text-muted-foreground/60" />
              <h2 className="mt-3 font-semibold text-foreground">Aucune année scolaire active</h2>
              <p className="mt-1 text-sm text-muted-foreground">Les indicateurs et graphiques apparaîtront dès qu’une année sera activée.</p>
            </div>
          )}

          <section>
            <div className="mb-5">
              <h2 className="text-lg font-bold tracking-tight text-foreground">Accès rapides</h2>
              <p className="mt-1 text-sm text-muted-foreground">Accédez directement aux tâches courantes.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <ActionLink to="/saisie-notes" icon={ClipboardCheck}>Saisir des notes</ActionLink>
              <ActionLink to="/bulletins" icon={FileText}>Consulter les bulletins</ActionLink>
              <ActionLink to="/vie-scolaire" icon={BookOpenCheck}>Ouvrir la vie scolaire</ActionLink>
            </div>
          </section>
        </>
      ) : (
        <div className="rounded-xl border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground">
          Aucun indicateur disponible pour le moment.
        </div>
      )}
    </div>
  );
}
