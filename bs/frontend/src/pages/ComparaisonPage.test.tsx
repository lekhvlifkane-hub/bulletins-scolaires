import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ComparaisonPage } from '@/pages/ComparaisonPage';

/**
 * La comparaison S1 / S2 est un relevé des snapshots : la page affiche les écarts déjà
 * calculés par le serveur et reporte les motifs quand un semestre manque.
 */

const CLASSE = {
  id: 'cls-1',
  name: 'TS 1',
  academicYear: { id: 'an-1', name: '2025-2026', status: 'ACTIVE' },
  level: { name: 'Terminale' },
  _count: { enrollments: 1 },
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

const LISTE = {
  semestre: { id: 'sem-1', numero: 1, nom: 'Semestre 1', academicYearId: 'an-1', anneeScolaire: '2025-2026' },
  lignes: [
    {
      enrollmentId: 'enc-1',
      studentId: 'eleve-1',
      matricule: 'MAT1',
      nom: 'Alpha',
      prenoms: 'Ndiaye',
      classe: 'TS 1',
      niveau: 'Terminale',
      bulletin: { id: 'rc-1' },
    },
    {
      enrollmentId: 'enc-2',
      studentId: 'eleve-2',
      matricule: 'MAT2',
      nom: 'Beta',
      prenoms: 'Diallo',
      classe: 'TS 1',
      niveau: 'Terminale',
      bulletin: { id: 'rc-2' },
    },
  ],
};

function semestre(
  numero: number,
  moyenne: string | null,
  options: { reportCardId?: string | null; motifs?: string[] } = {}
) {
  return {
    semestreId: `sem-${numero}`,
    numero,
    nom: `Semestre ${numero}`,
    reportCardId: options.reportCardId !== undefined ? options.reportCardId : `rc-${numero}`,
    version: 1,
    statut: 'PUBLIE',
    moyenneGenerale: moyenne,
    moyenneGeneraleAffichee: moyenne,
    rang: moyenne === null ? null : numero,
    effectif: moyenne === null ? null : 12,
    moyenneClasse: '14.8',
    incomplete: moyenne === null,
    motifs: options.motifs ?? [],
    matieres: [],
  };
}

function comparaison(overrides: Partial<{ s1: string | null; s2: string | null }> = {}) {
  const s1 = overrides.s1 === undefined ? '15.2' : overrides.s1;
  const s2 = overrides.s2 === undefined ? '18.2' : overrides.s2;
  const comparable = s1 !== null && s2 !== null;
  return {
    enrollmentId: 'enc-1',
    classroomId: 'cls-1',
    academicYearId: 'an-1',
    classe: 'TS 1',
    anneeScolaire: '2025-2026',
    bareme: '20',
    semestres: [
      semestre(1, s1),
      semestre(2, s2, s2 === null ? { reportCardId: null, motifs: ['Aucun bulletin pour ce semestre'] } : {}),
    ],
    generale: {
      ecart: comparable ? '3' : null,
      ecartAffiche: comparable ? '3.00' : null,
      motif: comparable
        ? null
        : s1 === null
          ? 'semestre 1 sans moyenne : écart non calculable'
          : 'semestre 2 sans moyenne : écart non calculable',
    },
    matieres: [
      {
        subjectId: 'sub-math',
        subjectName: 'Mathématiques',
        coefficient: '3',
        s1: '16',
        s2: comparable ? '19' : null,
        ecart: comparable ? '3' : null,
        ecartAffiche: comparable ? '3.00' : null,
      },
      {
        subjectId: 'sub-hige',
        subjectName: 'Histoire-Géographie',
        coefficient: '2',
        s1: null,
        s2: null,
        ecart: null,
        ecartAffiche: null,
      },
    ],
  };
}

function installer(reponses: Record<string, unknown>) {
  const appels: string[] = [];
  const mock = vi.fn(async (input: string) => {
    const url = String(input);
    appels.push(url);
    const cle = url.startsWith('/api/schooling/classes')
      ? 'classes'
      : url.startsWith('/api/schooling/years')
        ? 'years'
        : url.startsWith('/api/report-cards/comparaison')
          ? 'comparaison'
          : url.startsWith('/api/report-cards?')
            ? 'liste'
            : url;
    return {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => reponses[cle] ?? {},
    };
  });
  vi.stubGlobal('fetch', mock);
  return { appels };
}

function ouvrir(reponses: Record<string, unknown>) {
  const { appels } = installer({
    classes: { classes: [CLASSE] },
    years: ANNEES,
    liste: LISTE,
    comparaison: comparaison(),
    ...reponses,
  });
  render(
    <MemoryRouter initialEntries={['/comparaison-semestres']}>
      <ComparaisonPage />
    </MemoryRouter>
  );
  return { appels };
}

describe('ComparaisonPage — écarts entre semestres', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('affiche les écarts calculés par le serveur, sans les recomposer', async () => {
    const { appels } = ouvrir({});
    expect(await screen.findByText('Mathématiques')).toBeInTheDocument();

    // L'écart général et l'écart par matière viennent du serveur, chaîne déjà formatée.
    expect(screen.getAllByText('3.00')).toHaveLength(2);
    expect(screen.getByText('15.2')).toBeInTheDocument();
    expect(screen.getByText('18.2')).toBeInTheDocument();
    expect(appels.some((u) => u.includes('/api/report-cards/comparaison?enrollmentId=enc-1'))).toBe(true);

    // Les bulletins restent la source : on lie les deux documents.
    const liens = screen.getAllByRole('link', { name: 'Ouvrir le bulletin' });
    expect(liens.map((l) => l.getAttribute('href'))).toEqual(['/bulletins/rc-1', '/bulletins/rc-2']);
  });

  it('reporte le motif du serveur quand le semestre 2 manque, sans écart implicite', async () => {
    ouvrir({ comparaison: comparaison({ s2: null }) });
    expect(await screen.findByText('Aucun bulletin pour ce semestre')).toBeInTheDocument();

    expect(screen.getByText('semestre 2 sans moyenne : écart non calculable')).toBeInTheDocument();
    // Une matière sans les deux valeurs n'a pas d'écart : la page écrit « non calculable ».
    expect(screen.getAllByText('non calculable')).toHaveLength(2);
    expect(screen.getByText('Non calculable')).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(4);
    expect(screen.queryByText('3.00')).not.toBeInTheDocument();
  });

  it('redemande la comparaison au serveur quand on change d’élève', async () => {
    const { appels } = ouvrir({});
    await screen.findByText('Mathématiques');

    fireEvent.change(screen.getByLabelText('Élève'), { target: { value: 'enc-2' } });

    await waitFor(() =>
      expect(
        appels.some(
          (u) => u.includes('/api/report-cards/comparaison') && u.includes('enrollmentId=enc-2')
        )
      ).toBe(true)
    );
  });
});
