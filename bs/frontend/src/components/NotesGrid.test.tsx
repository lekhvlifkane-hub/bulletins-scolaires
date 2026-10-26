import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NotesGrid } from '@/components/NotesGrid';
import type { LigneNote } from '@/lib/notes';

function ligne(index: number, surcharge: Partial<LigneNote> = {}): LigneNote {
  const noms = [
    { nom: 'Alpha', prenoms: 'Ndiaye' },
    { nom: 'Beta', prenoms: 'Diallo' },
    { nom: 'Chérif', prenoms: 'Sow' },
  ];
  return {
    enrollmentId: `inscription-${index}`,
    studentId: `eleve-${index}`,
    matricule: `MAT${index}`,
    nom: noms[index].nom,
    prenoms: noms[index].prenoms,
    gradeId: null,
    score: null,
    status: 'NON_SAISIE',
    observation: null,
    ...surcharge,
  };
}

describe('NotesGrid — saisie rapide au clavier', () => {
  it('Entrée descend dans la même colonne', () => {
    render(
      <NotesGrid
        lignes={[ligne(0), ligne(1)]}
        barame="20"
        modifiable
        errors={{}}
        onChangeLine={vi.fn()}
      />
    );

    const premiere = screen.getByLabelText('Note de Alpha Ndiaye');
    const seconde = screen.getByLabelText('Note de Beta Diallo');
    premiere.focus();
    fireEvent.keyDown(premiere, { key: 'Enter' });

    expect(document.activeElement).toBe(seconde);
  });

  it('les flèches montent et descendent aussi sur la colonne statut', () => {
    render(
      <NotesGrid
        lignes={[ligne(0), ligne(1), ligne(2)]}
        barame="20"
        modifiable
        errors={{}}
        onChangeLine={vi.fn()}
      />
    );

    const premiere = screen.getByLabelText('Statut de la note de Alpha Ndiaye');
    const seconde = screen.getByLabelText('Statut de la note de Beta Diallo');
    premiere.focus();
    fireEvent.keyDown(premiere, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(seconde);

    fireEvent.keyDown(seconde, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(premiere);
  });

  it('↑ sur la première ligne ne déplace rien', () => {
    render(
      <NotesGrid lignes={[ligne(0)]} barame="20" modifiable errors={{}} onChangeLine={vi.fn()} />
    );

    const premiere = screen.getByLabelText('Note de Alpha Ndiaye');
    premiere.focus();
    fireEvent.keyDown(premiere, { key: 'ArrowUp' });

    expect(document.activeElement).toBe(premiere);
  });

  it('la saisie envoie la valeur brute et le statut correspondant, sans calcul', () => {
    const onChangeLine = vi.fn();
    render(
      <NotesGrid lignes={[ligne(0)]} barame="20" modifiable errors={{}} onChangeLine={onChangeLine} />
    );

    fireEvent.change(screen.getByLabelText('Note de Alpha Ndiaye'), { target: { value: '12,5' } });

    expect(onChangeLine).toHaveBeenCalledWith('inscription-0', { score: '12,5', status: 'SAISIE' });
  });

  it('effacer une note rend la ligne de nouveau « non saisie »', () => {
    const onChangeLine = vi.fn();
    render(
      <NotesGrid
        lignes={[ligne(0, { score: '12', status: 'SAISIE' })]}
        barame="20"
        modifiable
        errors={{}}
        onChangeLine={onChangeLine}
      />
    );

    fireEvent.change(screen.getByLabelText('Note de Alpha Ndiaye'), { target: { value: '' } });

    expect(onChangeLine).toHaveBeenCalledWith('inscription-0', { score: '', status: 'NON_SAISIE' });
  });

  it('un statut autre que « note saisie » retire le score', () => {
    const onChangeLine = vi.fn();
    render(
      <NotesGrid
        lignes={[ligne(0, { score: '8', status: 'SAISIE' })]}
        barame="20"
        modifiable
        errors={{}}
        onChangeLine={onChangeLine}
      />
    );

    fireEvent.change(screen.getByLabelText('Statut de la note de Alpha Ndiaye'), {
      target: { value: 'ABSENT' },
    });

    expect(onChangeLine).toHaveBeenCalledWith('inscription-0', { status: 'ABSENT', score: null });
  });

  it('une ligne déjà absente rend la note en lecture seule', () => {
    render(
      <NotesGrid
        lignes={[ligne(0, { score: null, status: 'ABSENT' })]}
        barame="20"
        modifiable
        errors={{}}
        onChangeLine={vi.fn()}
      />
    );

    expect(screen.getByLabelText('Note de Alpha Ndiaye')).toBeDisabled();
    expect(screen.getByLabelText('Statut de la note de Alpha Ndiaye')).toBeEnabled();
  });

  it('une saisie fermée désactive toute la grille', () => {
    render(
      <NotesGrid
        lignes={[ligne(0, { score: '8', status: 'SAISIE' })]}
        barame="20"
        modifiable={false}
        errors={{}}
        onChangeLine={vi.fn()}
      />
    );

    expect(screen.getByLabelText('Note de Alpha Ndiaye')).toBeDisabled();
    expect(screen.getByLabelText('Statut de la note de Alpha Ndiaye')).toBeDisabled();
    expect(screen.getByLabelText('Observation de Alpha Ndiaye')).toBeDisabled();
  });

  it('affiche le barème renvoyé et l’erreur de ligne', () => {
    render(
      <NotesGrid
        lignes={[ligne(0)]}
        barame="20"
        modifiable
        errors={{ 'inscription-0': 'Note hors barème (max 20)' }}
        onChangeLine={vi.fn()}
      />
    );

    expect(screen.getByText('Note / 20')).toBeInTheDocument();
    expect(screen.getByText('Note hors barème (max 20)')).toBeInTheDocument();
  });

  it('expose les champs avec des libellés utilisables sur mobile', () => {
    render(
      <NotesGrid lignes={[ligne(0)]} barame="20" modifiable errors={{}} onChangeLine={vi.fn()} />
    );

    expect(screen.getByLabelText('Note')).toBeInTheDocument();
    expect(screen.getByLabelText('Statut')).toBeInTheDocument();
    expect(screen.getByLabelText('Observation')).toBeInTheDocument();
  });
});
