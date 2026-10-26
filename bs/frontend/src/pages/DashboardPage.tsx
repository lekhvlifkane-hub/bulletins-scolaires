import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { chargerDashboard, type DashboardPlatform, type DashboardSchool } from '@/lib/dashboard';

const DashboardCharts = lazy(() => import('@/components/DashboardCharts'));

function CarteIndicateur({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <article className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      <p className="mt-2 text-3xl font-semibold tabular-nums">{value.toLocaleString('fr-FR')}</p>
      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
    </article>
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

  return (
    <div className="space-y-7">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-primary">{titreEtablissement ?? 'Bulletins Scolaires'}</p>
          <h1 className="mt-1 text-2xl font-semibold">Bonjour {user?.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {donnees?.scope === 'school' && donnees.academicYear
              ? `Vue d’ensemble — ${donnees.academicYear.name}`
              : 'Vue d’ensemble de votre espace'}
          </p>
        </div>
        <Button variant="outline" onClick={() => void charger()} disabled={chargement}>
          Actualiser
        </Button>
      </header>

      {erreur && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <span>{erreur}</span>
          <Button variant="outline" size="sm" onClick={() => void charger()}>Réessayer</Button>
        </div>
      )}

      {chargement && !donnees ? (
        <div role="status" className="rounded-xl border border-border p-8 text-center text-sm text-muted-foreground">
          Chargement des indicateurs…
        </div>
      ) : donnees?.scope === 'platform' ? (
        <section aria-label="Indicateurs plateforme" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <CarteIndicateur label="Établissements" value={donnees.indicators.schools} />
          <CarteIndicateur label="Établissements actifs" value={donnees.indicators.activeSchools} />
          <CarteIndicateur label="Comptes utilisateurs" value={donnees.indicators.users} />
        </section>
      ) : donnees?.scope === 'school' ? (
        <>
          <section aria-label="Indicateurs établissement" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <CarteIndicateur label="Élèves inscrits" value={donnees.indicators.enrollments} note={`${donnees.indicators.students} fiches élèves`} />
            <CarteIndicateur label="Classes" value={donnees.indicators.classrooms} />
            <CarteIndicateur label="Évaluations" value={donnees.indicators.assessments} />
            <CarteIndicateur label="Disciplines" value={donnees.indicators.subjects} />
            <CarteIndicateur label="Bulletins générés" value={donnees.indicators.bulletins} />
            <CarteIndicateur label="Bulletins publiés" value={donnees.indicators.publishedBulletins} />
            <CarteIndicateur
              label="Absences et retards"
              value={donnees.semesters.reduce((total, semester) => total + semester.absences + semester.retards, 0)}
              note="Événements enregistrés cette année"
            />
          </section>

          {donnees.semesters.length > 0 ? (
            <Suspense fallback={<div role="status" className="rounded-xl border border-border p-8 text-center text-sm text-muted-foreground">Chargement des graphiques…</div>}>
              <DashboardCharts semesters={donnees.semesters} />
            </Suspense>
          ) : (
            <div className="rounded-xl border border-dashed border-border p-8 text-center">
              <h2 className="font-medium">Aucune année scolaire active</h2>
              <p className="mt-1 text-sm text-muted-foreground">Les indicateurs et graphiques apparaîtront dès qu’une année sera activée.</p>
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            <Button asChild><Link to="/saisie-notes">Saisir des notes</Link></Button>
            <Button asChild variant="outline"><Link to="/bulletins">Consulter les bulletins</Link></Button>
            <Button asChild variant="outline"><Link to="/vie-scolaire">Ouvrir la vie scolaire</Link></Button>
          </div>
        </>
      ) : (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Aucun indicateur disponible pour le moment.
        </div>
      )}
    </div>
  );
}
