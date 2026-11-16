import { useRef, type KeyboardEvent } from 'react';
import { Table } from '@/components/ui/table';
import {
  LIBELLES_STATUT_EVALUATION,
  LIBELLES_STATUT_NOTE,
  type CelluleFeuille,
  type ColonneFeuille,
  type LigneFeuille,
  type StatutNote,
} from '@/lib/notes';

type NotesSheetProps = {
  colonnes: ColonneFeuille[];
  lignes: LigneFeuille[];
  errors: Record<string, string>;
  onChangeCell: (
    assessmentId: string,
    enrollmentId: string,
    patch: Partial<CelluleFeuille>
  ) => void;
};

export function cleCellule(assessmentId: string, enrollmentId: string): string {
  return `${assessmentId}:${enrollmentId}`;
}

/**
 * Feuille consolidée : une ligne par élève, une colonne par évaluation. La moyenne et
 * l'appréciation sont servies par le serveur, jamais recalculées dans le navigateur.
 */
export function NotesSheet({ colonnes, lignes, errors, onChangeCell }: NotesSheetProps) {
  const refs = useRef(new Map<string, HTMLInputElement | null>());
  const statuts = Object.keys(LIBELLES_STATUT_NOTE) as StatutNote[];

  const deplacer = (colonne: ColonneFeuille, indexLigne: number, delta: number) => {
    const cible = lignes[indexLigne + delta];
    if (!cible) return;
    refs.current.get(cleCellule(colonne.id, cible.enrollmentId))?.focus();
  };

  const surEnfonce = (
    event: KeyboardEvent<HTMLInputElement>,
    colonne: ColonneFeuille,
    indexLigne: number
  ) => {
    if (event.key === 'Enter' || event.key === 'ArrowDown') {
      event.preventDefault();
      deplacer(colonne, indexLigne, 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      deplacer(colonne, indexLigne, -1);
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <Table className="min-w-[980px] text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="sticky left-0 z-10 min-w-56 bg-muted/95 p-3 text-left">Élève</th>
            {colonnes.map((colonne) => (
              <th key={colonne.id} className="min-w-36 p-3 text-left align-bottom">
                <span className="block font-medium text-foreground">{colonne.title}</span>
                <span className="block text-xs font-normal text-muted-foreground">
                  {colonne.typeName} · /{colonne.outOf}
                </span>
                <span
                  className={
                    colonne.saisieAutorisee
                      ? 'mt-1 inline-block rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary'
                      : 'mt-1 inline-block rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground'
                  }
                >
                  {LIBELLES_STATUT_EVALUATION[colonne.status]}
                </span>
              </th>
            ))}
            <th className="min-w-24 p-3 text-right">Moy.</th>
            <th className="min-w-52 p-3 text-left">Appréciation</th>
          </tr>
        </thead>
        <tbody>
          {lignes.length === 0 ? (
            <tr>
              <td colSpan={colonnes.length + 3} className="p-3 text-muted-foreground">
                Aucun élève actif dans cette classe.
              </td>
            </tr>
          ) : (
            lignes.map((ligne, indexLigne) => (
              <tr key={ligne.enrollmentId} className="border-t border-border align-top">
                <td className="sticky left-0 z-10 bg-card p-3">
                  <span className="block font-medium">
                    {ligne.nom} {ligne.prenoms}
                  </span>
                  <span className="text-xs text-muted-foreground">{ligne.matricule}</span>
                </td>
                {colonnes.map((colonne) => {
                  const note = ligne.notes.find((n) => n.assessmentId === colonne.id);
                  const cle = cleCellule(colonne.id, ligne.enrollmentId);
                  const saisissable =
                    colonne.saisieAutorisee &&
                    (note?.status === 'SAISIE' || note?.status === 'NON_SAISIE');
                  return (
                    <td key={colonne.id} className="p-2">
                      <div className="space-y-1">
                        <input
                          ref={(element) => {
                            refs.current.set(cle, element);
                          }}
                          aria-label={`Note de ${ligne.nom} ${ligne.prenoms} — ${colonne.title}`}
                          inputMode="decimal"
                          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm disabled:bg-muted/40"
                          value={note?.score ?? ''}
                          disabled={!saisissable}
                          onChange={(event) => {
                            const valeur = event.target.value;
                            onChangeCell(colonne.id, ligne.enrollmentId, {
                              score: valeur,
                              status: valeur === '' ? 'NON_SAISIE' : 'SAISIE',
                            });
                          }}
                          onKeyDown={(event) => surEnfonce(event, colonne, indexLigne)}
                        />
                        <select
                          aria-label={`Statut de la note de ${ligne.nom} ${ligne.prenoms} — ${colonne.title}`}
                          className="h-8 w-full rounded-md border border-input bg-background px-1 text-xs disabled:bg-muted/40"
                          value={note?.status ?? 'NON_SAISIE'}
                          disabled={!colonne.saisieAutorisee}
                          onChange={(event) =>
                            onChangeCell(colonne.id, ligne.enrollmentId, {
                              status: event.target.value as StatutNote,
                              score: event.target.value === 'SAISIE' ? note?.score ?? null : null,
                            })
                          }
                        >
                          {statuts.map((statut) => (
                            <option key={statut} value={statut}>
                              {LIBELLES_STATUT_NOTE[statut]}
                            </option>
                          ))}
                        </select>
                        <input
                          aria-label={`Observation de ${ligne.nom} ${ligne.prenoms} — ${colonne.title}`}
                          className="h-8 w-full rounded-md border border-input bg-background px-1 text-xs disabled:bg-muted/40"
                          placeholder="Observation"
                          maxLength={200}
                          value={note?.observation ?? ''}
                          disabled={!colonne.saisieAutorisee}
                          onChange={(event) =>
                            onChangeCell(colonne.id, ligne.enrollmentId, {
                              observation: event.target.value,
                            })
                          }
                        />
                        {errors[cle] ? (
                          <p className="text-xs text-destructive">{errors[cle]}</p>
                        ) : null}
                      </div>
                    </td>
                  );
                })}
                <td
                  className="p-3 text-right font-semibold"
                  title={
                    ligne.moyenneExacte && ligne.moyenneExacte !== ligne.moyenne
                      ? `Valeur exacte : ${ligne.moyenneExacte}`
                      : undefined
                  }
                >
                  {ligne.moyenne ?? '—'}
                </td>
                <td className="p-3">
                  <p className="whitespace-normal">{ligne.appreciation ?? '—'}</p>
                  <span className="mt-1 inline-block rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                    Auto
                  </span>
                  {ligne.incomplet && ligne.motifs.length > 0 ? (
                    <p className="mt-1 text-xs text-muted-foreground">{ligne.motifs.join(' · ')}</p>
                  ) : null}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </Table>
    </div>
  );
}
