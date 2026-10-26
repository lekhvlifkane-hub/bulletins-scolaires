import { useRef, type KeyboardEvent } from 'react';
import { LIBELLES_STATUT_NOTE, type LigneNote, type StatutNote } from '@/lib/notes';

type NotesGridProps = {
  lignes: LigneNote[];
  barame: string;
  /** Fausse quand le statut de l'évaluation ferme la saisie. */
  modifiable: boolean;
  errors: Record<string, string>;
  onChangeLine: (enrollmentId: string, patch: Partial<LigneNote>) => void;
};

/**
 * Grille de saisie rapide au clavier : Entrée / flèches montent et descendent
 * dans la même colonne, Tab reste le parcours naturel. Aucune moyenne n'est
 * calculée ici : la grille ne fait que relancer les notes saisies.
 */
export function NotesGrid({ lignes, barame, modifiable, errors, onChangeLine }: NotesGridProps) {
  const notesRef = useRef<(HTMLInputElement | null)[]>([]);
  const statutsRef = useRef<(HTMLSelectElement | null)[]>([]);

  const deplacer = (index: number, colonne: 'note' | 'statut', delta: number) => {
    const suivante = index + delta;
    if (suivante < 0 || suivante >= lignes.length) return;
    const cible =
      colonne === 'note' ? notesRef.current[suivante] : statutsRef.current[suivante];
    cible?.focus();
  };

  const surEnfonceNote = (event: KeyboardEvent<HTMLInputElement>, index: number) => {
    if (event.key === 'Enter' || event.key === 'ArrowDown') {
      event.preventDefault();
      deplacer(index, 'note', 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      deplacer(index, 'note', -1);
    }
  };

  const surEnfonceStatut = (event: KeyboardEvent<HTMLSelectElement>, index: number) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      // Les flèches servent au déplacement entre lignes, pas au défilement natif.
      event.preventDefault();
      deplacer(index, 'statut', event.key === 'ArrowDown' ? 1 : -1);
    }
  };

  const statuts = Object.keys(LIBELLES_STATUT_NOTE) as StatutNote[];

  return (
    <div className="rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="hidden bg-muted/50 sm:table-header-group">
          <tr>
            <th className="p-3 text-left">Matricule</th>
            <th className="p-3 text-left">Élève</th>
            <th className="p-3 text-left">Note / {barame}</th>
            <th className="p-3 text-left">Statut</th>
            <th className="p-3 text-left">Observation</th>
          </tr>
        </thead>
        <tbody>
          {lignes.length === 0 ? (
            <tr>
              <td colSpan={5} className="p-3 text-muted-foreground">
                Aucun élève actif dans cette classe.
              </td>
            </tr>
          ) : (
            lignes.map((ligne, index) => {
              // Une ligne « non saisie » reste frappable : c'est le parcours clavier rapide.
              // Absent / annulée en revanche verrouillent la note (un 0 ne vaut pas une absence).
              const saisissable =
                modifiable && (ligne.status === 'SAISIE' || ligne.status === 'NON_SAISIE');
              return (
                <tr key={ligne.enrollmentId} className="block border-t border-border p-3 first:border-t-0 sm:table-row sm:p-0">
                  <td className="block p-1 sm:table-cell sm:p-2">
                    <span className="mr-2 text-xs font-medium text-muted-foreground sm:hidden">Matricule</span>
                    {ligne.matricule}
                  </td>
                  <td className="block p-1 sm:table-cell sm:p-2">
                    <span className="mr-2 text-xs font-medium text-muted-foreground sm:hidden">Élève</span>
                    {ligne.nom} {ligne.prenoms}
                  </td>
                  <td className="block p-1 sm:table-cell sm:p-2">
                    <label className="block text-xs font-medium text-muted-foreground sm:hidden" htmlFor={`score-${ligne.enrollmentId}`}>Note</label>
                    <input
                      id={`score-${ligne.enrollmentId}`}
                      aria-label={`Note de ${ligne.nom} ${ligne.prenoms}`}
                      ref={(element) => {
                        notesRef.current[index] = element;
                      }}
                      inputMode="decimal"
                      className="w-full rounded-md border border-input px-2 py-2 text-base disabled:bg-muted/40 sm:w-24 sm:py-1 sm:text-sm"
                      value={ligne.score ?? ''}
                      disabled={!saisissable}
                      onChange={(event) => {
                        const valeur = event.target.value;
                        onChangeLine(ligne.enrollmentId, {
                          score: valeur,
                          status: valeur === '' ? 'NON_SAISIE' : 'SAISIE',
                        });
                      }}
                      onKeyDown={(event) => surEnfonceNote(event, index)}
                    />
                  </td>
                  <td className="block p-1 sm:table-cell sm:p-2">
                    <label className="block text-xs font-medium text-muted-foreground sm:hidden" htmlFor={`status-${ligne.enrollmentId}`}>Statut</label>
                    <select
                      id={`status-${ligne.enrollmentId}`}
                      aria-label={`Statut de la note de ${ligne.nom} ${ligne.prenoms}`}
                      ref={(element) => {
                        statutsRef.current[index] = element;
                      }}
                      className="w-full rounded-md border border-input px-2 py-2 text-sm disabled:bg-muted/40 sm:w-auto sm:py-1"
                      value={ligne.status}
                      disabled={!modifiable}
                      onChange={(event) =>
                        onChangeLine(ligne.enrollmentId, {
                          status: event.target.value as StatutNote,
                          // Un 0 ne vaut pas une absence : on retire le score avec le statut.
                          score: event.target.value === 'SAISIE' ? ligne.score : null,
                        })
                      }
                      onKeyDown={(event) => surEnfonceStatut(event, index)}
                    >
                      {statuts.map((statut) => (
                        <option key={statut} value={statut}>
                          {LIBELLES_STATUT_NOTE[statut]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="block p-1 sm:table-cell sm:p-2">
                    <label className="block text-xs font-medium text-muted-foreground sm:hidden" htmlFor={`observation-${ligne.enrollmentId}`}>Observation</label>
                    <input
                      id={`observation-${ligne.enrollmentId}`}
                      aria-label={`Observation de ${ligne.nom} ${ligne.prenoms}`}
                      className="w-full min-w-40 rounded-md border border-input px-2 py-1 text-sm disabled:bg-muted/40"
                      value={ligne.observation ?? ''}
                      disabled={!modifiable}
                      maxLength={200}
                      onChange={(event) =>
                        onChangeLine(ligne.enrollmentId, { observation: event.target.value })
                      }
                    />
                    {errors[ligne.enrollmentId] ? (
                      <p className="mt-1 text-xs text-destructive">{errors[ligne.enrollmentId]}</p>
                    ) : null}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
