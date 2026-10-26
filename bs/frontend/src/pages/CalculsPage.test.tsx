import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CalculsPage } from '@/pages/CalculsPage';

/**
 * Le classement vient du serveur : la page doit afficher exactement les chaînes
 * reçues (rang, moyenne affichée, valeur exacte en infobulle), sans rien recalculer.
 */

const CLASSE = {
  id: 'cls-1',
  name: 'Terminale S1',
  academicYear: { id: 'an-1', name: '2025-2026', status: 'ACTIVE' },
  level: { name: 'Terminale' },
  _count: { enrollments: 3 },
};

const ANNEES = {
  years: [
    {
      id: 'an-1',
      name: '2025-2026',
      status: 'ACTIVE',
      semesters: [
        { id: 'sem-1', number: 1, name: 'Semestre 1' },
        { id: 'sem-2', number: 2, name: 'Semestre 2' },
      ],
    },
  ],
};

function matiere(moyenne: string | null, exacte: string | null) {
  return {
    subjectId: 'sub-1',
    subjectName: 'Mathématiques',
    coefficient: '3',
    moyenne,
    moyenneExacte: exacte,
    pointsPonderes: moyenne === null ? null : '45.6',
    comptabilisee: moyenne !== null,
    incomplet: false,
    motifs: moyenne === null ? ['Aucune note validée'] : [],
  };
}

const RESULTATS = {
  classroomId: 'cls-1',
  semesterId: 'sem-1',
  effectif: 3,
  moyenneClasse: '14.27',
  moyenneClasseExacte: '14.2666666667',
  motifs: [],
  eleves: [
    {
      enrollmentId: 'enc-1',
      studentId: 'eleve-1',
      matricule: 'MAT1',
      nom: 'Alpha',
      prenoms: 'Ndiaye',
      moyenneGenerale: '15.2',
      moyenneGeneraleExacte: '15.2',
      totalPoints: '45.6',
      totalCoeficients: '3',
      rang: 1,
      motifNonClasse: null,
      incomplet: false,
      matieres: [matiere('15.2', '15.2')],
    },
    {
      enrollmentId: 'enc-2',
      studentId: 'eleve-2',
      matricule: 'MAT2',
      nom: 'Beta',
      prenoms: 'Diallo',
      moyenneGenerale: '14.8',
      moyenneGeneraleExacte: '14.8',
      totalPoints: '44.4',
      totalCoeficients: '3',
      rang: 2,
      motifNonClasse: null,
      incomplet: false,
      matieres: [matiere('14.8', '14.8')],
    },
    {
      enrollmentId: 'enc-3',
      studentId: 'eleve-3',
      matricule: 'MAT3',
      nom: 'Gamma',
      prenoms: 'Sow',
      moyenneGenerale: '14.8',
      moyenneGeneraleExacte: '14.8',
      totalPoints: '44.4',
      totalCoeficients: '3',
      rang: 2,
      motifNonClasse: null,
      incomplet: false,
      matieres: [matiere('14.8', '14.80')],
    },
  ],
};

const BILAN = {
  effectif: 2,
  eleves: [
    {
      enrollmentId: 'enc-1',
      matricule: 'MAT1',
      nom: 'Alpha',
      prenoms: 'Ndiaye',
      s1: '15.2',
      s2: '17.2',
      annuelle: '16.2',
      annuelleExacte: '16.2',
      calculable: true,
      partiel: false,
      motifs: [],
    },
    {
      enrollmentId: 'enc-3',
      matricule: 'MAT3',
      nom: 'Gamma',
      prenoms: 'Sow',
      s1: '12',
      s2: null,
      annuelle: null,
      annuelleExacte: null,
      calculable: false,
      partiel: true,
      motifs: ['Semestre 2 sans moyenne'],
    },
  ],
};

type Appel = { url: string };

function installer(reponses: Record<string, unknown>) {
  const appels: Appel[] = [];
  const mock = vi.fn(async (input: string | URL) => {
    const url = String(input);
    appels.push({ url });
    const cle = url.startsWith('/api/schooling/classes')
      ? 'classes'
      : url.startsWith('/api/schooling/years')
        ? 'years'
        : url.startsWith('/api/calculations/annual')
          ? 'annual'
          : url.startsWith('/api/calculations')
            ? 'calculations'
            : url;
    return {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => reponses[cle] ?? {},
    };
  });
  vi.stubGlobal('fetch', mock);
  return { appels, mock };
}

describe('CalculsPage — calcul et classement', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('affiche les rangs renvoyés par le serveur, ex æquo compris', async () => {
    installer({ classes: { classes: [CLASSE] }, years: ANNEES, calculations: RESULTATS });
    render(<CalculsPage />);

    expect(await screen.findByText('MAT1')).toBeInTheDocument();

    const rangs = screen
      .getAllByText(/^\d+$/)
      .filter((element) => element.tagName === 'TD')
      .map((element) => element.textContent);
    expect(rangs).toEqual(['1', '2', '2']);

    // 15.2 sert à la fois de moyenne de matière et de moyenne générale : le rang, lui, vient du serveur.
    expect(screen.getAllByText('15.2').length).toBe(2);
    expect(screen.getByText('Moyenne de la classe')).toBeInTheDocument();
    expect(screen.getByText('14.27')).toBeInTheDocument();
  });

  it('garde la valeur exacte en infobulle et n’affiche que la valeur servie', async () => {
    const avecDecimales = {
      ...RESULTATS,
      moyenneClasse: '14.27',
      moyenneClasseExacte: '14.2666666667',
    };
    installer({ classes: { classes: [CLASSE] }, years: ANNEES, calculations: avecDecimales });
    render(<CalculsPage />);

    const cellule = await screen.findByTitle('Valeur exacte : 14.2666666667');
    expect(cellule).toHaveTextContent('14.27');
    expect(screen.queryByText('14.2666666667')).not.toBeInTheDocument();
  });

  it('demande la prévisualisation au serveur quand on inclut les brouillons', async () => {
    const { appels } = installer({
      classes: { classes: [CLASSE] },
      years: ANNEES,
      calculations: RESULTATS,
    });
    render(<CalculsPage />);

    await screen.findByText('MAT1');
    fireEvent.click(screen.getByRole('checkbox'));

    await waitFor(() =>
      expect(appels.some((a) => a.url.includes('inclureBrouillons=true'))).toBe(true)
    );
    expect(await screen.findByText(/prévisualisation, non officiel/)).toBeInTheDocument();
  });

  it('signale une matière sans moyenne validée avec le motif serveur', async () => {
    const incomplet = {
      ...RESULTATS,
      eleves: [
        {
          ...RESULTATS.eleves[0],
          moyenneGenerale: null,
          moyenneGeneraleExacte: null,
          rang: null,
          motifNonClasse: 'Aucune moyenne comptabilisée',
          incomplet: true,
          matieres: [matiere(null, null)],
        },
      ],
    };
    installer({ classes: { classes: [CLASSE] }, years: ANNEES, calculations: incomplet });
    render(<CalculsPage />);

    expect(await screen.findByText('Aucune moyenne comptabilisée')).toBeInTheDocument();
    expect(screen.getByText('Aucune note validée')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('bascule sur le bilan annuel et affiche non calculable quand il manque un semestre', async () => {
    installer({
      classes: { classes: [CLASSE] },
      years: ANNEES,
      calculations: RESULTATS,
      annual: BILAN,
    });
    render(<CalculsPage />);

    await screen.findByText('MAT1');
    fireEvent.click(screen.getByRole('button', { name: 'Bilan annuel' }));

    expect(await screen.findByText('non calculable')).toBeInTheDocument();
    expect(screen.getByText('Semestre 2 sans moyenne')).toBeInTheDocument();
    expect(screen.getByText('16.2')).toBeInTheDocument();
  });
});
