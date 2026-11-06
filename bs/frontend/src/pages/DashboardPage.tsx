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
    <Card className="gap-0 border-border shadow-sm">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <CardDescription className="max-w-[13rem] text-sm font-medium leading-5">{label}</CardDescription>
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ${toneStyles[tone]}`}>
          <Icon aria-hidden="true" className="h-[18px] w-[18px]" />
        </span>
      </CardHeader>
      <CardContent className="pt-0">
        <p className="text-3xl font-semibold leading-none tracking-tight text-brand-navy tabular-nums">
          {value.toLocaleString('fr-FR')}
        </p>
        {note && <p className="mt-2 text-sm text-muted-foreground">{note}</p>}
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
      className="group flex min-h-14 items-center gap-3 rounded-xl border border-border bg-card px-4 py-3.5 text-sm font-semibold text-foreground shadow-sm transition-colors hover:border-primary/40 hover:bg-primary/5"
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
    <div className="space-y-8">
      <section className="rounded-2xl bg-brand-navy px-6 py-7 text-white sm:px-8 sm:py-8 lg:px-10">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-2xl">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.08] px-3 py-1.5 text-xs font-medium text-white/80">
              <CalendarDays aria-hidden="true" className="h-3.5 w-3.5 text-accent" />
              {donnees?.scope === 'school' && donnees.academicYear
                ? donnees.academicYear.name
                : 'Votre espace de gestion'}
            </div>
            <p className="text-sm font-medium text-white/85">
              {titreEtablissement ?? (isPlatform ? 'Administration générale' : 'Bulletins Scolaires')}
            </p>
            <h1 className="mt-1.5 text-2xl font-bold tracking-tight sm:text-3xl">
              Bonjour{user?.name ? `, ${user.name.split(/\s+/)[0]}` : ''}
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-white/75">
              {isPlatform
                ? 'Retrouvez ici les indicateurs clés et gérez les établissements de la plateforme.'
                : 'Retrouvez en un coup d’œil les informations et les activités de votre établissement.'}
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => void charger()}
            disabled={chargement}
            className="min-h-11 border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white"
          >
            <RefreshCw aria-hidden="true" className={`h-4 w-4 ${chargement ? 'animate-spin' : ''}`} />
            Actualiser
          </Button>
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
            <div className="mb-4 flex items-end justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-foreground">Vue de la plateforme</h2>
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
            <div className="mb-4">
              <h2 className="text-base font-bold text-foreground">Les chiffres clés</h2>
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
              <div className="mb-4">
                <h2 className="text-base font-bold text-foreground">Suivi de l’année scolaire</h2>
                <p className="mt-1 text-sm text-muted-foreground">Progression des bulletins et vie scolaire par semestre.</p>
              </div>
              <Suspense
                fallback={
                  <div role="status" className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
                    Chargement des graphiques…
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
            <div className="mb-4">
              <h2 className="text-base font-bold text-foreground">Accès rapides</h2>
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
