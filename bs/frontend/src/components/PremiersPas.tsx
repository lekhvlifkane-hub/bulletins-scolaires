import { Link } from 'react-router-dom';
import { ArrowRight, CalendarDays, CheckCircle2, ClipboardList, GraduationCap, Layers3 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * Liste de contrôle « Premiers pas » du tableau de bord : visible tant que
 * l'établissement n'a pas terminé son installation de début d'année. Chaque
 * étape est un lien direct vers la page qui permet de la compléter.
 */

interface Etape {
  fait: boolean;
  to: string;
  titre: string;
  detail: string;
  icon: LucideIcon;
}

export function PremiersPas({
  anneeActive,
  classes,
  matieres,
  typesEvaluation,
}: {
  anneeActive: boolean;
  classes: number;
  matieres: number;
  typesEvaluation: number;
}) {
  const etapes: Etape[] = [
    {
      fait: anneeActive,
      to: '/classes',
      titre: 'Créer l’année scolaire',
      detail: 'L’année active et ses deux semestres.',
      icon: CalendarDays,
    },
    {
      fait: classes > 0,
      to: '/classes?onglet=classes',
      titre: 'Créer les classes',
      detail: 'Une classe par niveau ; les élèves s’y inscrivent ensuite.',
      icon: Layers3,
    },
    {
      fait: matieres > 0,
      to: '/disciplines',
      titre: 'Ajouter les matières',
      detail: 'Matières enseignées et leurs coefficients.',
      icon: GraduationCap,
    },
    {
      fait: typesEvaluation > 0,
      to: '/types-evaluation',
      titre: 'Définir devoirs et compositions',
      detail: 'Types d’évaluation et barèmes utilisés pour la saisie des notes.',
      icon: ClipboardList,
    },
  ];

  const restantes = etapes.filter((etape) => !etape.fait).length;

  return (
    <section aria-label="Premiers pas" className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-foreground">Premiers pas</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {restantes === etapes.length
              ? 'Installez votre établissement en 4 étapes — quelques minutes suffisent.'
              : `Il reste ${restantes} étape${restantes > 1 ? 's' : ''} avant la première saisie de notes.`}
          </p>
        </div>
        <span className="text-xs font-semibold text-muted-foreground">
          {etapes.length - restantes}/{etapes.length} terminées
        </span>
      </div>

      <ol className="mt-4 grid gap-2 sm:grid-cols-2">
        {etapes.map((etape, index) => (
          <li key={etape.to}>
            <Link
              to={etape.to}
              className={`group flex h-full items-center gap-3 rounded-xl border px-4 py-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                etape.fait
                  ? 'border-primary/25 bg-primary/5 text-muted-foreground hover:border-primary/40'
                  : 'border-border bg-background hover:border-primary/40 hover:bg-primary/5'
              }`}
            >
              {etape.fait ? (
                <CheckCircle2 aria-hidden="true" className="h-5 w-5 shrink-0 text-primary" />
              ) : (
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border text-xs font-semibold text-foreground">
                  {index + 1}
                </span>
              )}
              <span className="flex-1">
                <span className={`block font-semibold ${etape.fait ? 'text-foreground/70 line-through decoration-primary/40' : 'text-foreground'}`}>
                  {etape.titre}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{etape.detail}</span>
              </span>
              {!etape.fait && (
                <ArrowRight
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary"
                />
              )}
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
